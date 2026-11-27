import { constants } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  defaultRenderEngine,
  renderEngineSchema,
  type RenderEngine,
} from "@latex-renderer/contracts";
import { AppError, type ResourceLimits } from "@latex-renderer/shared";

export const INLINE_SOURCE_MAX_BYTES = 64 * 1024;
const DIRECT_SOURCE_MAX_BYTES = 4 * 1024 * 1024;
const DIRECT_SOURCE_MAX_FILE_BYTES = 1024 * 1024;
const DIRECT_SOURCE_MAX_FILES = 100;
export const SOURCE_UPLOAD_CHUNK_MAX_BYTES = 512 * 1024;
const ENVIRONMENT_INDEX_TTL_MS = 30_000;

/**
 * MCP Resource responses are encoded as a single blob/text value.  Keep this
 * well below the renderer's output limit so a client cannot turn a large
 * artifact into an unbounded Buffer + base64/string allocation.
 */
export const MAX_INLINE_ARTIFACT_BYTES = 16 * 1024 * 1024;

export interface RendererCapabilities {
  rendererVersion: string;
  texliveVersion: string;
  runtimeDigest: string | null;
  engineVerification: "verified" | "unknown";
  maxInlineArtifactBytes: number;
  engines: readonly RenderEngine[];
  engineOutputs?: ReadonlyArray<{
    engine: RenderEngine;
    pdf: boolean;
    svg: boolean;
    placement: boolean;
  }>;
  shellEscape: false;
  networkAccess: false;
  maxCompileSeconds: number;
  maxPdfPages: number;
  outputs: readonly ["pdf", "svg"];
  sourceLimits: {
    inlineBytes: number;
    directBytes: number;
    directFiles: number;
    directFileBytes: number;
    uploadBytes: number;
    files: number;
    fileBytes: number;
    chunkBytes: number;
  };
}

export interface EnvironmentSearch {
  query: string;
  matches: string[];
  nextCursor: string | null;
}

export class RendererEnvironment {
  constructor(
    private readonly environmentRoot: string,
    private readonly rendererVersion: string,
    private readonly resourceLimits: Readonly<ResourceLimits>,
    readonly maxInlineArtifactBytes: number,
  ) {}

  private environmentIndexPromise:
    Promise<{ packages: string[]; fonts: string[] }> | undefined;
  private environmentIndexCache:
    | {
        fingerprint: string;
        expiresAt: number;
        value: { packages: string[]; fonts: string[] };
      }
    | undefined;

  runtimeDigest() {
    return (
      this.rendererVersion.match(/(?:^|@)(sha256:[a-f0-9]{64})$/)?.[1] ?? null
    );
  }

  capabilities(): RendererCapabilities {
    const direct = directSourceLimits(this.resourceLimits);
    return {
      rendererVersion: this.rendererVersion,
      texliveVersion: "2026",
      runtimeDigest: this.runtimeDigest(),
      engineVerification: "unknown",
      maxInlineArtifactBytes: this.maxInlineArtifactBytes,
      engines: ["lualatex"],
      shellEscape: false,
      networkAccess: false,
      maxCompileSeconds: 300,
      maxPdfPages: 100,
      outputs: ["pdf", "svg"],
      sourceLimits: {
        inlineBytes: Math.min(
          INLINE_SOURCE_MAX_BYTES,
          direct.fileBytes,
          direct.contentBytes,
        ),
        directBytes: direct.contentBytes,
        directFiles: direct.files,
        directFileBytes: direct.fileBytes,
        uploadBytes: this.resourceLimits.maxUploadBytes,
        files: this.resourceLimits.maxFileCount,
        fileBytes: this.resourceLimits.maxUploadBytes,
        chunkBytes: SOURCE_UPLOAD_CHUNK_MAX_BYTES,
      },
    };
  }

  async verifiedCapabilities(): Promise<RendererCapabilities> {
    const capabilities = this.capabilities();
    if (capabilities.runtimeDigest === null) return capabilities;
    try {
      const file = await open(
        join(this.environmentRoot, "engines.json"),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const metadata = await file.stat();
        if (!metadata.isFile() || metadata.size > 4096) return capabilities;
        const bytes = Buffer.alloc(metadata.size);
        const { bytesRead } = await file.read(bytes);
        if (bytesRead !== metadata.size) return capabilities;
        const proof = JSON.parse(bytes.toString("utf8")) as {
          schemaVersion?: unknown;
          runtimeImage?: unknown;
          engines?: unknown;
        } | null;
        if (
          proof?.schemaVersion !== 1 ||
          proof.runtimeImage !== this.rendererVersion ||
          !Array.isArray(proof.engines) ||
          proof.engines.length > renderEngineSchema.options.length
        )
          return capabilities;
        const engineOutputs: NonNullable<
          RendererCapabilities["engineOutputs"]
        >[number][] = [];
        const seen = new Set<RenderEngine>();
        for (const entry of proof.engines as unknown[]) {
          if (typeof entry !== "object" || entry === null) return capabilities;
          const item = entry as {
            engine?: unknown;
            pdf?: unknown;
            svg?: unknown;
            placement?: unknown;
          };
          const result = renderEngineSchema.safeParse(item.engine);
          if (
            !result.success ||
            seen.has(result.data) ||
            typeof item.pdf !== "boolean" ||
            typeof item.svg !== "boolean" ||
            typeof item.placement !== "boolean" ||
            (item.placement && !item.svg) ||
            (item.svg && !item.pdf)
          )
            return capabilities;
          seen.add(result.data);
          engineOutputs.push({
            engine: result.data,
            pdf: item.pdf,
            svg: item.svg,
            placement: item.placement,
          });
        }
        const engines = engineOutputs
          .filter(({ pdf }) => pdf)
          .map(({ engine }) => engine);
        return engines.includes(defaultRenderEngine)
          ? {
              ...capabilities,
              engines,
              engineOutputs,
              engineVerification: "verified",
            }
          : capabilities;
      } finally {
        await file.close();
      }
    } catch {
      return capabilities;
    }
  }

  async checkPackages(
    names: readonly string[],
  ): Promise<Array<{ name: string; available: boolean }>> {
    return checkEnvironmentNames(
      names,
      (await this.environmentIndex()).packages,
    );
  }

  async searchPackages(query: string, cursor = 0): Promise<EnvironmentSearch> {
    return searchEnvironmentNames(
      query,
      cursor,
      (await this.environmentIndex()).packages,
    );
  }

  async checkFonts(
    names: readonly string[],
  ): Promise<Array<{ name: string; available: boolean }>> {
    return checkEnvironmentNames(names, (await this.environmentIndex()).fonts);
  }

  async searchFonts(query: string, cursor = 0): Promise<EnvironmentSearch> {
    return searchEnvironmentNames(
      query,
      cursor,
      (await this.environmentIndex()).fonts,
    );
  }

  private environmentIndex(): Promise<{ packages: string[]; fonts: string[] }> {
    if (this.environmentIndexPromise !== undefined)
      return this.environmentIndexPromise;
    this.environmentIndexPromise = this.loadEnvironmentIndex().finally(() => {
      this.environmentIndexPromise = undefined;
    });
    return this.environmentIndexPromise;
  }

  private async loadEnvironmentIndex(): Promise<{
    packages: string[];
    fonts: string[];
  }> {
    const fingerprint = await environmentFingerprint(
      this.environmentRoot,
      this.rendererVersion,
    );
    const cached = this.environmentIndexCache;
    if (
      cached !== undefined &&
      cached.fingerprint === fingerprint &&
      cached.expiresAt > Date.now()
    )
      return cached.value;
    const [packages, fonts] = await Promise.all([
      readEnvironmentList(join(this.environmentRoot, "packages.txt")),
      readEnvironmentList(join(this.environmentRoot, "fonts.txt")),
    ]);
    const value = { packages, fonts };
    this.environmentIndexCache = {
      fingerprint,
      expiresAt: Date.now() + ENVIRONMENT_INDEX_TTL_MS,
      value,
    };
    return value;
  }
}

export function directSourceLimits(resourceLimits: Readonly<ResourceLimits>) {
  return {
    files: Math.min(DIRECT_SOURCE_MAX_FILES, resourceLimits.maxFileCount),
    fileBytes: Math.min(
      DIRECT_SOURCE_MAX_FILE_BYTES,
      resourceLimits.maxUploadBytes,
      resourceLimits.maxExtractedBytes,
    ),
    contentBytes: Math.min(
      DIRECT_SOURCE_MAX_BYTES,
      resourceLimits.maxExtractedBytes,
    ),
  };
}

async function readEnvironmentList(path: string): Promise<string[]> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new AppError(
        "ENVIRONMENT_INVENTORY_UNAVAILABLE",
        "Renderer environment inventory is unavailable",
        503,
      );
    throw error;
  }
  return [
    ...new Set(
      content
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

async function environmentFingerprint(
  root: string,
  rendererVersion: string,
): Promise<string> {
  const entries = await Promise.all(
    ["packages.txt", "fonts.txt"].map(async (name) => {
      try {
        const info = await stat(join(root, name));
        return `${name}:${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return `${name}:missing`;
        throw error;
      }
    }),
  );
  return `${rendererVersion}|${entries.join("|")}`;
}

function checkEnvironmentNames(
  names: readonly string[],
  available: readonly string[],
): Array<{ name: string; available: boolean }> {
  if (names.length < 1 || names.length > 50)
    throw new AppError(
      "ENVIRONMENT_NAME_COUNT",
      "Between 1 and 50 names are required",
      400,
    );
  const normalized = new Set(available.map((name) => name.toLocaleLowerCase()));
  return names.map((name) => {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 200)
      throw new AppError(
        "ENVIRONMENT_NAME",
        "Package or font name is invalid",
        400,
      );
    return {
      name: trimmed,
      available: normalized.has(trimmed.toLocaleLowerCase()),
    };
  });
}

function searchEnvironmentNames(
  query: string,
  cursor: number,
  available: readonly string[],
): EnvironmentSearch {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length < 1 || normalizedQuery.length > 100)
    throw new AppError(
      "ENVIRONMENT_QUERY",
      "Search query must be between 1 and 100 characters",
      400,
    );
  if (!Number.isSafeInteger(cursor) || cursor < 0)
    throw new AppError("ENVIRONMENT_CURSOR", "Search cursor is invalid", 400);
  const all = available.filter((name) =>
      name.toLocaleLowerCase().includes(normalizedQuery),
    ),
    matches = all.slice(cursor, cursor + 50),
    next = cursor + matches.length;
  return {
    query,
    matches,
    nextCursor: next < all.length ? String(next) : null,
  };
}

export function inlineArtifactLimit(maxOutputBytes: number): number {
  return Math.min(
    MAX_INLINE_ARTIFACT_BYTES,
    Number.isSafeInteger(maxOutputBytes) && maxOutputBytes > 0
      ? maxOutputBytes
      : MAX_INLINE_ARTIFACT_BYTES,
  );
}
