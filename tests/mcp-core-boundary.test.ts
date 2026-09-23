import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("local MCP boundary", () => {
  it("uses shared core directly instead of spawning the CLI", () => {
    const entry = read("apps/mcp-server/src/index.ts");
    const server = read("apps/mcp-server/src/server.ts");
    const combined = `${entry}\n${server}`;

    expect(combined).toContain('from "@latex-renderer/mcp-core"');
    expect(combined).not.toContain("node:child_process");
    expect(combined).not.toContain("LATEX_RENDER_CLI_PATH");
    expect(combined).not.toContain("spawn(");
    expect(combined).not.toContain('"--json"');
  });

  it("keeps output schemas and structured content on every tool", () => {
    const server = read("apps/mcp-server/src/server.ts");
    const tools = server.match(/server\.registerTool\(/g) ?? [],
      schemas = server.match(/outputSchema:/g) ?? [];
    expect(tools.length).toBeGreaterThanOrEqual(7);
    expect(schemas).toHaveLength(tools.length);
    expect(server).toMatch(
      /server\.registerTool\(\s*"attach_project_revision"/,
    );
    expect(server).toContain("structuredContent: output");
  });

  it("bundles mcp-core from workspace source for clean client builds", () => {
    const build = read("client/build-client.mjs");
    expect(build).toContain('"@latex-renderer/mcp-core"');
    expect(build).toContain('"packages/mcp-core/src/index.ts"');
  });
});
