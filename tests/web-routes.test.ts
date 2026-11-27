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
  it("links to and serves the SVG favicon", async () => {
    const app = createWebApp(dist);
    for (const path of ["/", "/docs/", "/app/", "/admin/"]) {
      const page = await app.request(path);
      expect(await page.text()).toContain('href="/favicon.svg"');
    }
    const icon = await app.request("/favicon.svg");
    expect(icon.status).toBe(200);
    expect(icon.headers.get("content-type")).toBe("image/svg+xml");
    expect(await icon.text()).toContain("<svg");
  });

  it("serves public, documentation, and admin pages", async () => {
    const app = createWebApp(dist);
    for (const path of [
      "/",
      "/docs/",
      "/docs/web/",
      "/docs/windows/",
      "/docs/cli/",
      "/ja/docs/",
      "/ja/docs/cli/",
      "/en/docs/",
      "/en/docs/web/",
      "/en/assets/docs-search.json",
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
  it("exposes deployment check markers independently of the display language", async () => {
    const createApp = (rendering: boolean) =>
      createWebApp(dist, () => Promise.resolve({
        api: true,
        rendering,
        downloads: true,
        checkedAt: "2026-11-25T00:00:00Z",
      }));
    const ready = createApp(true), unavailable = createApp(false);
    for (const locale of ["en", "ja"]) {
      const init = { headers: { "Accept-Language": locale } };
      const home = await (await ready.request("/", init)).text();
      expect(home).toContain(`lang="${locale}"`);
      expect(home).toContain('data-public-page="home"');
      expect(await (await ready.request("/downloads/", init)).text()).toContain(
        'href="/downloads/client/latest.zip"',
      );
      const online = await (await ready.request("/status/", init)).text();
      const offline = await (await unavailable.request("/status/", init)).text();
      expect(online).toContain('data-rendering-status="online"');
      expect(offline).toContain('data-rendering-status="offline"');
      expect(offline).not.toContain('data-rendering-status="online"');
    }
  });
  it("serves user rendering separately from administrator operations", async () => {
    const app = createWebApp(dist),
      legacy = await app.request("/render/", { redirect: "manual" });
    expect(legacy.status).toBe(308);
    expect(legacy.headers.get("location")).toBe("/app/");
    const renderPage = await (await app.request("/app/", {
      headers: { "Accept-Language": "ja" },
    })).text();
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
  it("uses explicit locale, device preference, browser locale and English fallback in order", async () => {
    const app = createWebApp(dist);
    const headers = {
      Cookie: "latex_renderer_locale=fr",
      "Accept-Language": "ja,en;q=0.5",
    };
    const explicit = await app.request("/login/?locale=de&return_to=%2Fapp%2F", { headers });
    expect(explicit.headers.get("set-cookie")).toContain("latex_renderer_locale=de");
    const login = await explicit.text();
    expect(login).toContain('<html lang="de">');
    expect(login).toContain('href="?locale=fr&amp;return_to=%2Fapp%2F"');
    expect(await (await app.request("/app/", { headers })).text()).toContain('<html lang="fr">');
    expect(await (await app.request("/", {
      headers: { "Accept-Language": "zh-Hant, ko;q=0.8" },
    })).text()).toContain('<html lang="ko">');
    expect(await (await app.request("/", {
      headers: { "Accept-Language": "ar,zh-Hant;q=0.9" },
    })).text()).toContain('<html lang="en">');
  });
  it("serves localized guides and search without changing legacy routes or anchors", async () => {
    const app = createWebApp(dist);
    const french = await (await app.request("/fr/docs/web/")).text();
    expect(french).toContain('<html lang="fr">');
    expect(french).toContain('href="/en/docs/web/"');
    expect(french).toContain('data-index-url="/fr/assets/docs-search.json"');
    const japanese = await (await app.request("/docs/web/", {
      headers: { "Accept-Language": "fr" },
    })).text();
    expect(japanese).toContain('<html lang="ja">');
    expect((await app.request("/fr/docs/web", { redirect: "manual" })).headers.get("location"))
      .toBe("/fr/docs/web/");
    expect(await (await app.request("/en/docs/web/")).text()).toContain('id="edit-a-project"');
    expect(await (await app.request("/fr/assets/docs-search.json")).text()).toContain('"url":"/fr/docs/web/"');
  });
  it("serves the login controller without pre-rendering inactive methods", async () => {
    const app = createWebApp(dist),
      page = await (await app.request("/login/")).text(),
      script = await app.request("/assets/login.js"),
      css = await (await app.request("/assets/styles.css")).text();
    expect(page).toContain('src="/assets/login.js"');
    expect(page).toContain('id="login-methods"');
    expect(page).not.toContain('id="password-login"');
    expect(page).not.toContain('id="external-login"');
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
    expect(html).toContain('src="/admin/assets/admin.js?locale=en"');
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
