import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPublicDocsValid,
  type DocsValidationInput,
} from "./apps/admin-web/src/docs-validation.js";
import { publicDocs } from "./apps/admin-web/src/markdown-docs.js";

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
