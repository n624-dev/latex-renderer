import { describe, expect, it } from "vitest";
import { createWebApp } from "../apps/admin-web/src/app.js";
const bytes = new TextEncoder().encode("test"),
  dist = {
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
describe("unified web", () => {
  it("serves public, documentation, and admin pages", async () => {
    const app = createWebApp(dist);
    for (const path of [
      "/",
      "/docs/",
      "/docs/web/",
      "/docs/windows/",
      "/docs/cli/",
      "/docs/integrations/",
      "/docs/mcp/",
      "/docs/projects/",
      "/docs/troubleshooting/",
      "/docs/security/",
      "/docs/api/",
      "/docs/contributing/",
      "/admin/",
      "/admin/jobs/",
      "/admin/sources/",
      "/admin/docs/",
      "/downloads/",
      "/app/",
      "/app/history/",
      "/app/projects/",
      "/app/environment/",
    ])
      expect((await app.request(path)).status).toBe(200);
  });
  it("serves user rendering separately from administrator operations", async () => {
    const app = createWebApp(dist),
      legacy = await app.request("/render/", { redirect: "manual" });
    expect(legacy.status).toBe(308);
    expect(legacy.headers.get("location")).toBe("/app/");
    const renderPage = await (await app.request("/app/")).text();
    expect(renderPage).toContain("LaTeXをPDFに変換");
    expect(renderPage).toContain("TeX / ZIPをここにドロップ");
    expect(renderPage).toContain('id="app-project-select"');
    expect(renderPage).not.toContain("apiKeyId");
    expect(renderPage).not.toContain("sourceRef");
    expect(renderPage).not.toContain("Access保護領域");
    expect(renderPage).not.toContain("短命ticket");
    expect(renderPage).not.toContain("SHA-256");
    const oldAdmin = await app.request("/admin/render/", {
      redirect: "manual",
    });
    expect(oldAdmin.status).toBe(308);
    expect(oldAdmin.headers.get("location")).toBe("/app/");
    expect((await app.request("/app/assets/app.js")).status).toBe(200);
    expect((await app.request("/admin/assets/render.js")).status).toBe(200);
    expect((await app.request("/assets/render.js")).status).toBe(404);
  });
  it("serves the login controller and keeps inactive methods hidden", async () => {
    const app = createWebApp(dist),
      page = await (await app.request("/login/")).text(),
      script = await app.request("/assets/login.js"),
      css = await (await app.request("/assets/styles.css")).text();
    expect(page).toContain('src="/assets/login.js"');
    expect(script.status).toBe(200);
    expect(await script.text()).toContain("/auth/config");
    expect(css).toContain("[hidden] { display: none !important; }");
  });
  it("redirects legacy client URLs", async () => {
    const response = await createWebApp(dist).request("/client/install.ps1", {
      redirect: "manual",
    });
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "/downloads/windows/install.ps1",
    );
  });
  it("keeps administrator assets on the Access-protected namespace", async () => {
    const app = createWebApp(dist);
    const page = await app.request("/admin/");
    const html = await page.text();
    expect(html).toContain('src="/admin/assets/admin.js"');
    expect(html).toContain('data-cfasync="false"');
    expect((await app.request("/admin/assets/admin.js")).status).toBe(200);
    expect((await app.request("/admin/assets/site.js")).status).toBe(200);
    expect((await app.request("/admin/assets/styles.css")).status).toBe(200);
    expect((await app.request("/assets/admin.js")).status).toBe(404);
  });
  it("prevents Cloudflare HTML rewrites and permits admin blob previews", async () => {
    const response = await createWebApp(dist).request("/admin/");
    expect(response.headers.get("cache-control")).toContain("no-transform");
    expect(response.headers.get("content-security-policy")).toContain(
      "img-src 'self' data: blob:",
    );
  });
});
