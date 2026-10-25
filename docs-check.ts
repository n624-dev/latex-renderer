import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPublicDocsValid,
  type DocsValidationInput,
} from "./apps/admin-web/src/docs-validation.js";
import { publicDocs } from "./apps/admin-web/src/markdown-docs.js";
import {
  parseReleaseVersion,
  validStableVersion,
  compareReleaseVersions,
} from "./deploy/scripts/release-version.mjs";

const repositoryRoot = dirname(fileURLToPath(import.meta.url));

export function repositoryDocsValidationInput(): DocsValidationInput {
  return {
    docs: publicDocs,
    publicPaths: [
      "/",
      "/downloads/",
      "/status/",
      "/app/",
      "/app/environment/",
      "/openapi/gateway.openapi.yaml",
      "/openapi/renderer.openapi.yaml",
    ],
    openApis: [
      openApi("Gateway OpenAPI", "gateway.openapi.yaml"),
      openApi("Renderer OpenAPI", "renderer.openapi.yaml"),
    ],
    resolveCliHelp: cliHelp,
  };
}

export function checkRepositoryDocs(): void {
  assertPublicDocsValid(repositoryDocsValidationInput());
  const root = JSON.parse(
    readFileSync(join(repositoryRoot, "package.json"), "utf8"),
  ) as { version: string };
  const stable = JSON.parse(
    readFileSync(
      join(repositoryRoot, "docs/self-hosting-release.json"),
      "utf8",
    ),
  ) as { version: string };
  validateSelfHostingVersion(
    stable.version,
    root.version,
    Object.fromEntries(
      ["README.md", "SETUP.md", "docs/public/self-hosting.md"].map((path) => [
        path,
        readFileSync(join(repositoryRoot, path), "utf8"),
      ]),
    ),
  );
}

/** RC builds continue to recommend a verified Stable, never the unpublished RC.
 * A Stable promotion must update the pointer and all pinned entry points. */
export function validateSelfHostingVersion(
  stable: string,
  current: string,
  documents: Record<string, string>,
): void {
  validStableVersion(stable);
  const release = parseReleaseVersion(current);
  if (
    (!release.prerelease && current !== stable) ||
    (release.prerelease && compareReleaseVersions(stable, current) >= 0)
  )
    throw new Error(
      "Self-hosting guide must track the verified Stable release",
    );
  for (const path of ["README.md", "SETUP.md", "docs/public/self-hosting.md"]) {
    const text = documents[path] ?? "";
    const tags = [
      ...text.matchAll(
        /https:\/\/github\.com\/n624-dev\/latex-renderer\/releases\/tag\/v([0-9]+\.[0-9]+\.[0-9]+(?:-rc\.[0-9]+)?)/g,
      ),
    ].map((match) => match[1]);
    const archives = [
      ...text.matchAll(
        /latex-renderer-server-([0-9]+\.[0-9]+\.[0-9]+(?:-rc\.[0-9]+)?)\.tar\.gz/g,
      ),
    ].map((match) => match[1]);
    if (
      tags.length === 0 ||
      [...tags, ...archives].some((version) => version !== stable) ||
      (path !== "README.md" && archives.length === 0)
    )
      throw new Error(`Inconsistent pinned self-hosting release: ${path}`);
  }
  const guide = documents["docs/public/self-hosting.md"] ?? "";
  if (
    !guide.includes(`version=${stable}\n`) ||
    !guide.includes(`## v${stable}をダウンロードして検証`) ||
    guide.includes("上記Stable bundleにはまだ含まれません")
  )
    throw new Error(
      "Self-hosting download or authentication availability is stale",
    );
}

function openApi(name: string, filename: string) {
  return {
    name,
    publicPath: `/openapi/${filename}`,
    source: readFileSync(join(repositoryRoot, "openapi", filename), "utf8"),
  };
}

function cliHelp(commandPath: string): string | undefined {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      join(repositoryRoot, "apps/cli/src/index.ts"),
      ...commandPath.split(" "),
      "--help",
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  return result.status === 0 ? result.stdout : undefined;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  checkRepositoryDocs();
  process.stdout.write(
    `Public documentation validation passed (${publicDocs.length} pages).\n`,
  );
}
