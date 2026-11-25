import { open } from "node:fs/promises";
import { join } from "node:path";
import { sha256Hex } from "@latex-renderer/shared";

export type DocumentRequirement =
  | { kind: "package" | "class" | "distribution"; name: string }
  | {
      kind: "font";
      name: string;
      style?: string | undefined;
      characters?: string | undefined;
      math?: boolean | undefined;
    }
  | { kind: "feature"; name: "network" | "shell_escape" };

export class DocumentRequirementInventory {
  private cached?: { fingerprint: string; data: string };
  constructor(
    private readonly root: string,
    private readonly runtime: string,
  ) {}

  async check(requirements: readonly DocumentRequirement[]) {
    const inventory = await this.read();
    if (requirements.length === 0)
      return { items: [], inventoryVersion: inventory ? 1 : null };
    const data = new Set(inventory?.data.split("\n") ?? []);
    const indexedFaces = [...data].flatMap((line) => {
      if (!line.startsWith("font\t")) return [];
      const [, names, styles, charset] = line.split("\t");
      return names && styles && charset
        ? [{ names: names.split(","), styles, charset }]
        : [];
    });
    const items = requirements.map((requirement) => {
      if (requirement.kind === "feature")
        return {
          ...requirement,
          state: "unsupported_by_sandbox",
          evidence: "sandbox_policy",
        };
      if (inventory === undefined)
        return {
          ...requirement,
          state: "not_checked",
          evidence: "no_matching_runtime_inventory",
        };
      if (requirement.kind !== "font") {
        const installed = data.has(`${requirement.kind}\t${requirement.name}`);
        return {
          ...requirement,
          state: installed ? "installed" : "not_found",
          canonicalName: installed ? requirement.name : null,
          loadable: "not_checked",
          evidence: "runtime_inventory",
        };
      }
      const family = requirement.name.toLocaleLowerCase("en");
      const faces = indexedFaces.flatMap(({ names, styles, charset }) => {
        const name = names.find(
          (candidate) => candidate.toLocaleLowerCase("en") === family,
        );
        return name === undefined ? [] : [{ name, styles, charset }];
      });
      if (faces.length === 0)
        return {
          ...requirement,
          state: "not_found",
          loadable: "not_checked",
          evidence: "runtime_font_inventory",
        };
      const style = requirement.style?.toLocaleLowerCase("en");
      const candidates = faces.filter(
        ({ styles }) =>
          style === undefined ||
          styles
            .split(",")
            .some((candidate) => candidate.toLocaleLowerCase("en") === style),
      );
      if (candidates.length === 0)
        return {
          ...requirement,
          state: "missing_style",
          canonicalName: faces[0]?.name,
          loadable: "not_checked",
          styles: [
            ...new Set(faces.flatMap(({ styles }) => styles.split(","))),
          ].slice(0, 20),
          evidence: "runtime_font_inventory",
        };
      const codePoints = [
        ...new Set(
          Array.from(
            requirement.characters ?? "",
            (char) => char.codePointAt(0) ?? 0,
          ),
        ),
      ];
      // Coverage applies to one concrete face. Never union multiple faces to
      // claim the requested style renders characters in the document.
      const coverage = candidates.map(({ charset }) => {
        const ranges = charsetRanges(charset);
        return codePoints.filter(
          (point) =>
            !ranges.some(([lower, upper]) => point >= lower && point <= upper),
        );
      });
      const missing = coverage.reduce(
        (best, found) => (found.length < best.length ? found : best),
        codePoints,
      );
      const matchingFace = coverage.some((candidate) => candidate.length === 0);
      return {
        ...requirement,
        canonicalName: candidates[0]?.name,
        state: matchingFace ? "installed" : "missing_glyphs",
        missingCodePoints: missing.map(
          (point) => `U+${point.toString(16).toUpperCase().padStart(4, "0")}`,
        ),
        loadable: "not_checked",
        mathSupport: requirement.math === true ? "not_checked" : null,
        evidence: "fontconfig_face_and_charset",
      };
    });
    return { items, inventoryVersion: inventory ? 1 : null };
  }

  private async read() {
    try {
      const file = await open(
        join(this.root, "document-requirements.json"),
        "r",
      );
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 4 * 1024 * 1024) return undefined;
        const fingerprint = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
        if (this.cached?.fingerprint === fingerprint) return this.cached;
        const bytes = Buffer.alloc(stat.size);
        if ((await file.read(bytes)).bytesRead !== stat.size) return undefined;
        const value = JSON.parse(bytes.toString("utf8")) as {
          version?: number;
          runtime?: string;
          entries?: string;
        } | null;
        if (
          value?.version !== 1 ||
          value.runtime !== this.runtime ||
          typeof value.entries !== "string"
        )
          return undefined;
        this.cached = { fingerprint, data: value.entries };
        return this.cached;
      } finally {
        await file.close();
      }
    } catch {
      return undefined;
    }
  }
}

function charsetRanges(charset: string): [number, number][] {
  return charset.split(" ").flatMap((range) => {
    const [start, end] = range.split("-");
    if (start === undefined || !/^[0-9a-f]+$/i.test(start)) return [];
    const lower = Number.parseInt(start, 16);
    return [[lower, end === undefined ? lower : Number.parseInt(end, 16)]];
  });
}

// Declarations at the start of a line are candidates. TeX expansion, included
// files and dynamically selected names are outside this bounded read.
export function staticEntrypointRequirements(text: string, hasMore: boolean) {
  const lines = text.split(/\r?\n/);
  if (hasMore) lines.pop();
  const items: Array<{
    kind: "class" | "package" | "font";
    name: string;
    line: number;
  }> = [];
  const seen = new Set<string>();
  const declaration =
    /^\s*\\(documentclass|usepackage|RequirePackage|setmainfont|setmainjfont|setsansfont|setmonofont|setmathfont)\s*(?:\[[^\]\r\n]*\]\s*)?\{([^{}\r\n]*)\}/;
  for (const [index, line] of lines.entries()) {
    const [, command, body] = declaration.exec(line) ?? [];
    if (command === undefined || body === undefined) continue;
    const kind =
      command === "documentclass"
        ? "class"
        : command === "usepackage" || command === "RequirePackage"
          ? "package"
          : "font";
    for (const value of kind === "package" ? body.split(",") : [body]) {
      const name = value.trim();
      const valid =
        kind === "font"
          ? /^[\p{L}\p{N} ._+-]{1,100}$/u.test(name)
          : /^[A-Za-z0-9][A-Za-z0-9_.+-]{0,99}$/.test(name);
      const key = `${kind}:${name}`;
      if (!valid || seen.has(key)) continue;
      if (items.length >= 32) return { items, truncated: true };
      seen.add(key);
      items.push({ kind, name, line: index + 1 });
    }
  }
  return { items, truncated: hasMore };
}

export function requirementsFingerprint(input: unknown) {
  return sha256Hex(JSON.stringify(input));
}
