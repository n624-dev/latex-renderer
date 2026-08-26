import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("setup core boundary", () => {
  it("keeps lifecycle ownership and diagnostics in the shared package", () => {
    const core = read("packages/setup-core/src/index.ts");
    for (const operation of [
      "installDistribution",
      "inspectSetup",
      "repairSetup",
      "removeSetup",
      "doctorSetup",
      "saveCredential",
    ])
      expect(core).toContain(`function ${operation}`);
    expect(core).toContain("UNMANAGED_INSTALLATION");
    expect(core).toContain("managedMcpClients");
  });

  it("uses the same setup-core from the CLI and downloadable entrypoints", () => {
    expect(read("apps/cli/src/index.ts")).toContain(
      'from "@latex-renderer/setup-core"',
    );
    expect(read("client/install.ts")).toContain(
      'from "@latex-renderer/setup-core"',
    );
    expect(read("client/uninstall.ts")).toContain(
      'from "@latex-renderer/setup-core"',
    );
    const build = read("client/build-client.mjs");
    expect(build).toContain('"client/install.ts"');
    expect(build).toContain('"client/uninstall.ts"');
  });

  it("bundles client workspace sources without depending on prebuilt dist files", () => {
    const build = read("client/build-client.mjs");
    expect(build).toContain("workspaceAliases");
    for (const workspace of [
      "api-client",
      "client-core",
      "contracts",
      "setup-core",
      "setup-web",
      "shared",
    ])
      expect(build).toContain(`packages/${workspace}/src/index.ts`);
    expect(build).toContain("alias: workspaceAliases");
  });

  it("passes the installed root through every platform launcher", () => {
    for (const launcher of [
      "client/unix/latex-render",
      "client/unix/latex-renderer-mcp",
      "client/windows/latex-render.cmd",
      "client/windows/latex-renderer-mcp.cmd",
    ])
      expect(read(launcher)).toContain("LATEX_RENDER_INSTALL_DIRECTORY");
  });
});
