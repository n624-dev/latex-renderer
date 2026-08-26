import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("Local Setup Web UI boundaries", () => {
  it("binds only to an explicit loopback host and a random port", () => {
    const server = read("packages/setup-web/src/index.ts");
    expect(server).toContain('type LoopbackHost = "127.0.0.1" | "::1"');
    expect(server).toContain("port: 0");
    expect(server).toContain("isLoopbackAddress");
    expect(server).not.toContain('"0.0.0.0"');
  });

  it("keeps setup operations in setup-core and client-core", () => {
    const server = read("packages/setup-web/src/index.ts");
    expect(server).toContain('from "@latex-renderer/setup-core"');
    expect(server).toContain('from "@latex-renderer/client-core"');
    expect(server).toContain("installDistribution");
    expect(server).toContain("repairSetup");
    expect(server).toContain("doctorSetup");
    expect(server).toContain("renderProject");
  });

  it("uses external assets and launches only through setup --gui", () => {
    const assets = read("packages/setup-web/src/assets.ts");
    const cli = read("apps/cli/src/index.ts");
    expect(assets).toContain('src="/assets/setup.js"');
    expect(assets).not.toContain("unsafe-inline");
    expect(cli).toContain('.option("--gui"');
    expect(cli).toContain("runSetupWeb");
  });
});
