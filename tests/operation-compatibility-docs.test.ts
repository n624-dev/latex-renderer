import { readdirSync, readFileSync } from "node:fs";
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
  expect(bundle.tools.map(({ name }) => name).sort()).toEqual(
    [...local].sort(),
  );
  expect(remote.toSorted()).toEqual(
    Object.keys(rendererMcpToolPolicies).sort(),
  );
  const rows = Array.from(
    read("docs/mcp-operation-compatibility.md").matchAll(
      /^\| +`([a-z_]+)` +\| [^|]+ \| +([○×]) +\| +([○×]) +\| +([○×]) +\| ([^|]*) \|$/gm,
    ),
  );
  expect(rows.map(([, name]) => name).sort()).toEqual(
    [...new Set([...local, ...remote])].sort(),
  );
  const localScopes = new Map<string, string>(
    (
      [
        [
          "render:create",
          "get_renderer_capabilities",
          "list_authoring_profiles",
          "check_packages",
          "search_packages",
          "check_fonts",
          "search_fonts",
          "check_document_requirements",
          "probe_document_requirements",
          "retry_render",
          "retry_svg_render",
        ],
        [
          "render:read:own",
          "get_render_diagnostics",
          "read_render_log",
          "get_render_manifest",
        ],
        [
          "render:pdf:inspect",
          "get_render_preview_crop",
          "get_render_preview_sheet",
          "locate_render_source",
          "compare_render_quality",
        ],
      ] as const
    ).flatMap(([scope, ...tools]) =>
      tools.map((tool) => [tool, scope] as const),
    ),
  );
  const guides = [
    "docs/public/mcp.md",
    ...readdirSync(new URL("../docs/public/", import.meta.url), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map(({ name }) => `docs/public/${name}/mcp.md`),
  ];
  for (const guide of guides) {
    const localTools = read(guide)
      .split(/\| `upload_source` +\|/)[1]
      ?.split("\n\n")[0];
    for (const [name, scope] of localScopes)
      expect(
        localTools?.split("\n").find((row) => row.includes(`\`${name}\``)),
        `${guide} ${name}`,
      ).toContain(`\`${scope}\``);
  }
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
    const localScope = localScopes.get(name);
    if (localScope) expect(note, name).toContain(`\`${localScope}\``);
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
