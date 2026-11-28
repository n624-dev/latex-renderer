import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { asRendererTool } from "../apps/public-mcp-gateway/src/renderer-dispatch.js";
import {
  rendererApiAuthoringRoutes,
  savedRevisionFileTools,
} from "../packages/contracts/src/renderer-mcp-definitions.js";
import { rendererMcpToolPolicies } from "../packages/contracts/src/renderer-mcp.js";
import { runtimeSettingKeys } from "../packages/database/src/runtime-settings.js";
import { SERVER_RUNTIME_LIMITS } from "../packages/server-setup-core/src/index.mjs";

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function registeredTools(path: string): string[] {
  return Array.from(
    read(path).matchAll(/\.registerTool\(\s*"([a-z_]+)"/g),
    ([, name]) => name,
  ).filter((name): name is string => name !== undefined);
}

const localProjectScopes = new Map([
  ["get_project_revision_downloads", "render:project:read"],
  ["get_project_document_state", "render:project:state:read"],
  ["update_project_document_conditions", "render:project:state:write"],
  ["adopt_project_revision", "render:project:state:write"],
  ["list_project_pdf_reviews", "render:project:state:read"],
  ["record_project_pdf_review", "render:project:state:write"],
  ["get_project_storage_usage", "render:project:read"],
  ["protect_project_revision", "render:create"],
  ["plan_project_revision_cleanup", "render:project:read"],
  ["apply_project_revision_cleanup", "render:project:delete"],
]);

it("documents each MCP tool and its connection support", () => {
  const local = new Set([
    ...registeredTools("apps/mcp-server/src/server.ts"),
    ...Object.keys(rendererApiAuthoringRoutes),
    ...Object.keys(savedRevisionFileTools),
  ]);
  const remote = registeredTools("apps/remote-mcp/src/mcp.ts");
  const bundle = JSON.parse(read("client/mcpb/manifest.json")) as {
    tools: Array<{ name: string }>;
  };
  expect(bundle.tools.map(({ name }) => name).sort()).toEqual([...local].sort());
  expect(remote.toSorted()).toEqual(
    Object.keys(rendererMcpToolPolicies).sort(),
  );
  const rows = Array.from(
    read("docs/mcp-operation-compatibility.md").matchAll(
      /^\| `([a-z_]+)` \| [^|]+ \| ([○×]) \| ([○×]) \| ([○×]) \| ([^|]*) \|$/gm,
    ),
  );
  expect(rows.map(([, name]) => name).sort()).toEqual(
    [...new Set([...local, ...remote])].sort(),
  );
  const policies = new Map<string, { scope: string | null }>(
    Object.entries(rendererMcpToolPolicies),
  );
  for (const [, name, localMark, remoteMark, publicMark, note] of rows) {
    if (name === undefined) throw new Error("Missing MCP tool name");
    const policy = policies.get(name);
    expect(localMark === "○", name).toBe(local.has(name));
    expect(remoteMark === "○", name).toBe(remote.includes(name));
    expect(publicMark === "○", name).toBe(asRendererTool(name) !== undefined);
    if (policy?.scope) expect(note, name).toContain(`\`${policy.scope}\``);
    const localScope = localProjectScopes.get(name);
    if (localScope) expect(note, name).toContain(`Local \`${localScope}\``);
  }
  for (const [name, scope] of localProjectScopes) {
    expect(local.has(name)).toBe(true);
    for (const path of ["docs/public/mcp.md", "docs/public/en/mcp.md"]) {
      // Find the tool name and scope in the same row within the Local tools table.
      const toolTable = read(path)
        .split(/## Local MCP(?:のツール| tools)/)[1]
        ?.split("\n## ")[0];
      const row = toolTable
        ?.split("\n")
        .find((line) => line.startsWith("|") && line.includes(`\`${name}\``));
      expect(row, name).toContain(`\`${scope}\``);
    }
  }
});

it("documents all system setting keys and server wizard resource limits", () => {
  const docs = read("docs/admin-operation-compatibility.md");
  const keys = Array.from(
    docs.matchAll(/^\| `([a-z_]+)` \| [○×] \| [○×] \| [○×] \|$/gm),
    ([, key]) => key,
  );
  const limits = Array.from(
    docs.matchAll(/^\| `([a-zA-Z]+)` [^|]+ \| [○×] \| [○×] \| [○×] \|$/gm),
    ([, limit]) => limit,
  );
  expect(keys.sort()).toEqual([...runtimeSettingKeys].sort());
  expect(limits.sort()).toEqual(Object.keys(SERVER_RUNTIME_LIMITS).sort());
});
