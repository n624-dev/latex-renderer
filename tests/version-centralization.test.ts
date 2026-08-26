import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLIENT_VERSION, PLATFORM_VERSION } from "../packages/shared/src/version.js";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

function workspacePackageFiles(): string[] {
  return ["apps", "packages"].flatMap((workspace) =>
    readdirSync(join(repositoryRoot, workspace), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(repositoryRoot, workspace, entry.name, "package.json")),
  );
}

describe("version centralization", () => {
  it("keeps runtime and every workspace package version aligned", () => {
    const root = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")) as { version: string };
    expect(CLIENT_VERSION).toBe(PLATFORM_VERSION);
    expect(PLATFORM_VERSION).toBe(root.version);

    for (const packageFile of workspacePackageFiles()) {
      const workspacePackage = JSON.parse(readFileSync(packageFile, "utf8")) as { name: string; version: string };
      expect(workspacePackage.version, workspacePackage.name).toBe(root.version);
    }
  });
});
