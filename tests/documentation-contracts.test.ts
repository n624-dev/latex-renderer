import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function registeredTools(path: string): string[] {
  return [...read(path).matchAll(/server\.registerTool\(\s*"([^"]+)"/g)].map(
    (match) => match[1] as string,
  );
}

describe("documentation implementation contracts", () => {
  it("documents the latest database migration", () => {
    const versions = readdirSync(
      new URL("../deploy/migrations/", import.meta.url),
    ).flatMap((filename) => {
      const match = /^(\d{3})_.*\.sql$/.exec(filename);
      return match?.[1] === undefined ? [] : [Number(match[1])];
    });
    expect(versions.length).toBeGreaterThan(0);

    const latest = String(Math.max(...versions)).padStart(3, "0");
    expect(read("MIGRATIONS.md")).toContain(`## Migration ${latest}:`);
    expect(read("DEPLOYMENT.md")).toContain(`Migration ${latest}`);
  });

  it("documents every canonical Gateway Worker route", () => {
    const routes = [
      ...read("apps/gateway-worker/wrangler.example.jsonc").matchAll(
        /"pattern":\s*"(latex\.example\.com\/api\/v1\/[^"]+)"/g,
      ),
    ].map((match) => match[1] as string);
    expect(routes.length).toBeGreaterThan(0);

    const accessDocs = read("CLOUDFLARE_ACCESS.md");
    for (const route of routes) expect(accessDocs).toContain(route);
  });

  it("documents the protected App surface and mirrors unified Tunnel order", () => {
    const tunnel = read("deploy/cloudflared/config.example.yml"),
      accessDocs = read("CLOUDFLARE_ACCESS.md"),
      tunnelDocs = accessDocs.slice(accessDocs.indexOf("## Tunnel order")),
      expected = [
        [
          "path: ^/\\.well-known/oauth-(authorization-server|protected-resource)(/.*)?$",
          "OAuth discovery metadata",
        ],
        ["path: ^/(oauth|mcp)(/.*)?$", "`/oauth/*` and `/mcp`"],
        ["path: ^/admin/api(/.*)?$", "`/admin/api/*`"],
        ["path: ^/admin(/.*)?$", "`/admin/*`"],
        ["path: ^/app/api(/.*)?$", "`/app/api/*`"],
        ["path: ^/app(/.*)?$", "`/app/*`"],
        ["path: ^/api(/.*)?$", "`/api/*`"],
      ] as const;
    let tunnelOffset = -1,
      docsOffset = -1;
    for (const [configMarker, docsMarker] of expected) {
      const nextTunnelOffset = tunnel.indexOf(configMarker),
        nextDocsOffset = tunnelDocs.indexOf(docsMarker);
      expect(nextTunnelOffset).toBeGreaterThan(tunnelOffset);
      expect(nextDocsOffset).toBeGreaterThan(docsOffset);
      tunnelOffset = nextTunnelOffset;
      docsOffset = nextDocsOffset;
    }

    expect(accessDocs).toContain("latex.example.com/app");
    expect(read("ARCHITECTURE.md")).toContain("/app/api/v1/");
    expect(read("DEPLOYMENT.md")).toContain("`/app/` and `/admin/`");
  });

  it("documents the compile and whole-job timeout defaults", () => {
    const compileMatch = /timeout -s TERM -k 2 (\d+) latexmk/.exec(
      read("renderer/compile.sh"),
    );
    const jobMatch = /^RENDERER_JOB_TIMEOUT_SECONDS=(\d+)$/m.exec(
      read(".env.example"),
    );
    if (compileMatch?.[1] === undefined || jobMatch?.[1] === undefined)
      throw new Error("Renderer timeout defaults could not be located");

    expect(read("RESOURCE_LIMITS.md")).toContain(
      `${compileMatch[1]} s / ${jobMatch[1]} s`,
    );
  });

  it("keeps the operations service list aligned with deployment", () => {
    const deployment = read("DEPLOYMENT.md");
    const blockStart = deployment.indexOf("sudo systemctl enable --now");
    const blockEnd = deployment.indexOf("```", blockStart);
    if (blockStart < 0 || blockEnd < 0)
      throw new Error("Deployment systemd enable block could not be located");

    const services = [
      ...new Set(
        [
          ...deployment
            .slice(blockStart, blockEnd)
            .matchAll(/latex-renderer-[a-z-]+\.service/g),
        ].map((match) => match[0]),
      ),
    ];
    expect(services.length).toBeGreaterThan(0);

    const operations = read("OPERATIONS.md");
    for (const service of services)
      expect(operations).toContain(`\`${service}\``);
  });

  it("documents every Local and Remote MCP tool in the canonical MCP guide", () => {
    const tools = [
      ...registeredTools("apps/mcp-server/src/server.ts"),
      ...registeredTools("apps/remote-mcp/src/mcp.ts"),
    ];
    expect(tools.length).toBeGreaterThan(0);

    const mcpDocs = read("docs/public/mcp.md");
    for (const tool of tools) expect(mcpDocs).toContain(`\`${tool}\``);
  });

  it("keeps root integration guides delegated to canonical documentation", () => {
    expect(read("CLI_GUIDE.md")).toContain("docs/public/cli.md");
    expect(read("MCP_GUIDE.md")).toContain("docs/public/mcp.md");
    expect(read("SKILL_GUIDE.md")).toContain(
      "integrations/latex-renderer/SKILL.md",
    );
  });

  it("documents the private Internal API VPC boundary and Source auth flow", () => {
    expect(read("ARCHITECTURE.md")).toContain(
      "`INTERNAL_API` Workers VPC Service binding",
    );
    expect(read("API_AUTHENTICATION.md")).toContain(
      "`POST /api/v1/source-tickets`",
    );
    expect(read("API_AUTHENTICATION.md")).toContain(
      "`PUT /api/v1/sources/:sourceId/content`",
    );
  });
});
