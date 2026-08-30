import { describe, expect, it } from "vitest";
import { createPublicStaticAssets } from "../apps/admin-web/src/static-site.js";

const bytes = new TextEncoder().encode("test");
const distribution = {
  version: "0.2.0",
  archiveName: "latex-renderer-client-0.2.0.zip",
  manifest: bytes,
  installer: bytes,
  uninstaller: bytes,
  commonInstaller: bytes,
  commonUninstaller: bytes,
  archive: bytes,
  gatewayOpenApi: bytes,
  rendererOpenApi: bytes,
  adminOpenApi: bytes,
};

describe("public web static build", () => {
  it("emits all public routes without administrator assets", () => {
    const assets = new Map(
      createPublicStaticAssets(distribution).map((asset) => [
        asset.path,
        asset.content,
      ]),
    );

    expect([...assets.keys()].sort()).toEqual([
      "404.html",
      "_headers",
      "_redirects",
      "assets/docs-search.json",
      "assets/login.js",
      "assets/site.js",
      "assets/styles.css",
      "docs/api/index.html",
      "docs/cli/index.html",
      "docs/client/index.html",
      "docs/contributing/index.html",
      "docs/index.html",
      "docs/integrations/index.html",
      "docs/mcp/index.html",
      "docs/projects/index.html",
      "docs/security/index.html",
      "docs/self-hosting/index.html",
      "docs/troubleshooting/index.html",
      "docs/web/index.html",
      "docs/windows/index.html",
      "downloads/client/install.mjs",
      "downloads/client/latest.zip",
      "downloads/client/latex-renderer-client-0.2.0.zip",
      "downloads/client/manifest.json",
      "downloads/client/uninstall.mjs",
      "downloads/index.html",
      "downloads/windows/install.ps1",
      "downloads/windows/latest.zip",
      "downloads/windows/latex-renderer-client-0.2.0.zip",
      "downloads/windows/manifest.json",
      "downloads/windows/uninstall.ps1",
      "index.html",
      "openapi/gateway.openapi.yaml",
      "openapi/renderer.openapi.yaml",
    ]);
    expect(assets.get("index.html")).toContain("LaTeXをPDFに変換");
    expect(assets.get("assets/login.js")).toContain("/auth/config");
    expect(assets.get("assets/styles.css")).toContain(
      "[hidden] { display: none !important; }",
    );
    expect(assets.has("render/index.html")).toBe(false);
    expect(assets.has("assets/render.js")).toBe(false);
    expect(assets.get("404.html")).toContain("ページが見つかりません");
    expect(assets.get("docs/index.html")).toContain("最短でPDFを作る");
    expect(assets.get("downloads/index.html")).toContain("0.2.0");
    expect(assets.get("downloads/windows/latest.zip")).toBe(bytes);
    expect(assets.get("downloads/client/latest.zip")).toBe(bytes);
    expect(assets.has("assets/admin.js")).toBe(false);
    expect(assets.has("admin/index.html")).toBe(false);
    expect(assets.has("status/index.html")).toBe(false);
    expect(assets.has("admin/openapi/admin.openapi.yaml")).toBe(false);
  });

  it("defines explicit cache and security headers", () => {
    const headerFile = createPublicStaticAssets(distribution).find(
      (asset) => asset.path === "_headers",
    )?.content;

    expect(headerFile).toContain("Cache-Control: public, max-age=0");
    expect(headerFile).toContain("no-transform");
    expect(headerFile).toContain("Content-Security-Policy:");
    expect(headerFile).toContain("img-src 'self' data: blob:");
    expect(headerFile).toContain("X-LaTeX-Renderer-Serving: workers-static");
    expect(headerFile).toContain("X-Content-Type-Options: nosniff");
    expect(headerFile).toContain("Content-Type: application/zip");
    expect(headerFile).toContain(
      'Content-Disposition: attachment; filename="latex-renderer-client-0.2.0.zip"',
    );
  });

  it("publishes the signed MCPB and metadata when present", () => {
    const mcpbDistribution = {
        ...distribution,
        mcpbName: "latex-renderer-local-0.2.0.mcpb",
        mcpbMetadata: bytes,
        mcpb: bytes,
      },
      assets = new Map(
        createPublicStaticAssets(mcpbDistribution).map((asset) => [
          asset.path,
          asset.content,
        ]),
      );
    expect(assets.get("downloads/mcpb/latest.mcpb")).toBe(bytes);
    expect(assets.get("downloads/mcpb/latex-renderer-local-0.2.0.mcpb")).toBe(
      bytes,
    );
    expect(assets.get("downloads/mcpb/mcpb.json")).toBe(bytes);
    expect(assets.get("downloads/index.html")).toContain(
      "Claude Desktop拡張を取得",
    );
    expect(assets.get("_headers")).toContain("/downloads/mcpb/*.mcpb");
  });

  it("preserves legacy client redirects", () => {
    const redirectFile = createPublicStaticAssets(distribution).find(
      (asset) => asset.path === "_redirects",
    )?.content;

    expect(redirectFile).toContain("/docs/windows /docs/windows/ 308");
    expect(redirectFile).toContain("/docs/security /docs/security/ 308");
    expect(redirectFile).toContain(
      "/docs/self-hosting /docs/self-hosting/ 308",
    );
    expect(redirectFile).toContain(
      "/docs/contributing /docs/contributing/ 308",
    );
    expect(redirectFile).toContain("/downloads /downloads/ 308");
    expect(redirectFile).not.toContain("/render ");
    expect(redirectFile).toContain("/client /downloads/ 308");
    expect(redirectFile).toContain(
      "/client/latest.zip /downloads/client/latest.zip 308",
    );
  });

  it("keeps generated public navigation targets available", () => {
    const assets = new Map(
      createPublicStaticAssets(distribution).map((asset) => [
        asset.path,
        asset.content,
      ]),
    );
    const missing = new Set<string>();

    for (const [path, content] of assets) {
      if (!path.endsWith(".html") || typeof content !== "string") continue;
      for (const match of content.matchAll(/\b(?:href|src)="(\/[^"#?]*)"/g)) {
        const reference = match[1];
        if (
          reference === undefined ||
          reference === "/status/" ||
          reference.startsWith("/app/") ||
          reference.startsWith("/admin/")
        )
          continue;
        const assetPath =
          reference === "/"
            ? "index.html"
            : reference.endsWith("/")
              ? `${reference.slice(1)}index.html`
              : reference.slice(1);
        if (!assets.has(assetPath)) missing.add(`${path}: ${reference}`);
      }
    }

    expect([...missing]).toEqual([]);
  });

  it("is deterministic", () => {
    expect(createPublicStaticAssets(distribution)).toEqual(
      createPublicStaticAssets(distribution),
    );
  });
});
