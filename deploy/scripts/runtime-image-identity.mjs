#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareReleaseVersions } from "./release-version.mjs";

// Frozen release-metadata contracts. Never extend either list in place:
// installed updaters must be able to validate the next release's metadata.
export const RELEASE_RENDERER_FILES_V1 = Object.freeze([
  "texmf.cnf", "latexmkrc", "compile.sh", "svg-wrapper.tex", "export-svg.pl",
]);
export const RELEASE_RENDERER_FILES_V2 = Object.freeze([
  ...RELEASE_RENDERER_FILES_V1, "install-language-packages.sh",
]);

export const RUNTIME_IDENTITY_VERSION = "runtime-v1";
export const RENDERER_RUNTIME_FILES = Object.freeze([
  "texmf.cnf",
  "latexmkrc",
  "compile.sh",
  "svg-wrapper.tex",
  "export-svg.pl",
  "install-language-packages.sh",
]);

export function normalizeRuntimeLanguages(values) {
  const languages = [...new Set(values.map(String))].sort();
  for (const language of languages) {
    if (!/^collection-lang[A-Za-z0-9._-]+$/.test(language)) {
      throw new Error(`Invalid TeX Live language collection: ${language}`);
    }
  }
  return languages;
}

export async function rendererRuntimeFingerprint(rendererRoot) {
  return fingerprintFiles(rendererRoot, RENDERER_RUNTIME_FILES);
}

export async function legacyReleaseRendererFingerprint(rendererRoot) {
  return fingerprintFiles(rendererRoot, RELEASE_RENDERER_FILES_V1);
}

// Call only after verifying the immutable archive's digest and provenance.
// The old field remains compatible with RC.3; the new field binds all six
// Runtime inputs. Missing/unknown new contracts fail closed for RC.5 onward.
export async function validatedReleaseRendererFingerprint(rendererRoot, manifest) {
  const legacy = await legacyReleaseRendererFingerprint(rendererRoot);
  const identity = manifest.rendererRuntimeIdentity;
  if (identity !== undefined) {
    if (identity?.schemaVersion !== 2 ||
        identity.fingerprint !== await fingerprintFiles(rendererRoot, RELEASE_RENDERER_FILES_V2)) {
      throw new Error("Release Runtime identity mismatch or unsupported schema");
    }
    return legacy;
  }
  // Historical boundary, not the active application version. Keep it stable
  // when release tooling replaces the candidate version during promotion.
  const identityRequiredSince = `${[1, 3, 4].join(".")}-rc.${5}`;
  if (compareReleaseVersions(manifest.version, identityRequiredSince) >= 0) {
    throw new Error("Release Runtime identity is required");
  }
  // Historical RC.4 emitted six files in the unversioned field. Older releases
  // emitted five. The signed manifest version determines the historical rule.
  return manifest.version === "1.3.4-rc.4"
    ? fingerprintFiles(rendererRoot, RELEASE_RENDERER_FILES_V2) : legacy;
}

async function fingerprintFiles(rendererRoot, files) {
  const aggregate = createHash("sha256");
  for (const file of files) {
    const digest = createHash("sha256")
      .update(await readFile(join(rendererRoot, file)))
      .digest("hex");
    aggregate.update(`${file} ${digest}\n`);
  }
  return aggregate.digest("hex");
}

export function runtimeIdentity({ baseImageId, rendererFingerprint, languages, snapshotDate = null }) {
  if (!/^sha256:[a-f0-9]{64}$/.test(baseImageId)) {
    throw new Error("Runtime identity requires an immutable sha256 Base image ID");
  }
  if (!/^[a-f0-9]{64}$/.test(rendererFingerprint)) {
    throw new Error("Runtime identity requires a renderer runtime fingerprint");
  }
  const normalized = normalizeRuntimeLanguages(languages);
  if (snapshotDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
    throw new Error("Runtime identity snapshot date must use YYYY-MM-DD");
  }
  const digest = createHash("sha256")
    .update([RUNTIME_IDENTITY_VERSION, baseImageId, rendererFingerprint, ...normalized, ""].join("\n"))
    .digest("hex");
  return {
    version: RUNTIME_IDENTITY_VERSION,
    digest,
    tag: `${RUNTIME_IDENTITY_VERSION}-${snapshotDate ?? "custom"}-${digest.slice(0, 32)}`,
    baseImageId,
    rendererFingerprint,
    languages: normalized,
    snapshotDate,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const rendererRoot = process.env.RENDERER_RUNTIME_SOURCE ?? join(repoRoot, "renderer");
  if (args[0] === "--release-legacy-fingerprint") {
    process.stdout.write(`${await legacyReleaseRendererFingerprint(rendererRoot)}\n`);
    return;
  }
  if (args[0] === "--renderer-fingerprint") {
    process.stdout.write(`${await rendererRuntimeFingerprint(rendererRoot)}\n`);
    return;
  }
  let format = "json";
  if (args[0] === "--format") {
    format = args[1] ?? "";
    args.splice(0, 2);
  }
  const baseRef = args.shift();
  if (!baseRef) {
    throw new Error("usage: runtime-image-identity.mjs [--format json|tag|digest|fingerprint] BASE_IMAGE [collection-lang...]");
  }
  const baseImageId = execFileSync(
    "docker",
    ["image", "inspect", baseRef, "--format", "{{.Id}}"],
    { encoding: "utf8" },
  ).trim();
  const repository = execFileSync(
    "docker",
    ["image", "inspect", baseRef, "--format", '{{index .Config.Labels "jp.n624.latex-renderer.texlive.repository"}}'],
    { encoding: "utf8" },
  ).trim();
  const snapshotMatch = /tlnet-archive\/(\d{4})\/(\d{2})\/(\d{2})\/tlnet/.exec(repository);
  const identity = runtimeIdentity({
    baseImageId,
    rendererFingerprint: await rendererRuntimeFingerprint(rendererRoot),
    languages: args,
    snapshotDate: snapshotMatch ? `${snapshotMatch[1]}-${snapshotMatch[2]}-${snapshotMatch[3]}` : null,
  });
  if (format === "json") process.stdout.write(`${JSON.stringify(identity)}\n`);
  else if (format === "tag") process.stdout.write(`${identity.tag}\n`);
  else if (format === "digest") process.stdout.write(`${identity.digest}\n`);
  else if (format === "fingerprint") process.stdout.write(`${identity.rendererFingerprint}\n`);
  else throw new Error(`Unsupported output format: ${format}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  await main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
