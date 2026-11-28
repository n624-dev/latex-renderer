import { randomBytes } from "node:crypto";
import {
  displayLocales,
  matchDisplayLocale,
  preferredDisplayLanguages,
  resolveDisplayLocale,
  type DisplayLocale,
} from "@latex-renderer/shared/locale";
import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import {
  localizedAdminRenderScript,
  localizedAdminScript,
} from "./assets/admin-script.js";
import { localizedAppScript } from "./assets/localized-app-script.js";
import { readBrowserAsset } from "./browser-assets.js";
import { styles } from "./assets/styles.js";
import { isVersionedWebFont, webFontAsset } from "./assets/font-assets.js";
import { editorAsset, readEditorAssetVersion } from "./editor-assets.js";
import { favicon } from "./favicon.js";
import type { StatusProbe } from "./status-probe.js";
import {
  binaryResponse,
  type ClientDistribution,
} from "./client-distribution.js";
import {
  localizedDocumentation,
  publicDocumentationPages,
} from "./docs-pages.js";
import { publicDocsSearchJson } from "./markdown-docs.js";
import {
  adminPage,
  adminRenderPage,
  adminDocsPage,
  appEnvironmentPage,
  appHistoryPage,
  appJobPage,
  appProjectPage,
  appProjectEditorPage,
  appProjectsPage,
  appRenderPage,
  downloadsPage,
  homePage,
  loginPage,
  publicPage404,
  statusPage,
} from "./templates.js";

const displayLocaleCookie = "latex_renderer_locale";

function pageLocale(c: Context, routeLocale?: DisplayLocale): DisplayLocale {
  const choice = c.req.query("locale");
  const selected =
    routeLocale ??
    (choice === undefined ? undefined : matchDisplayLocale(choice));
  if (selected !== undefined)
    setCookie(c, displayLocaleCookie, selected, {
      path: "/",
      sameSite: "Lax",
      maxAge: 365 * 24 * 60 * 60,
      secure: new URL(c.req.url).protocol === "https:",
    });
  return resolveDisplayLocale({
    selected,
    saved: getCookie(c, displayLocaleCookie),
    preferred: preferredDisplayLanguages(c.req.header("Accept-Language")),
  });
}

export function createWebApp(
  distribution: ClientDistribution,
  statusProbe: StatusProbe = () =>
    Promise.resolve({
      api: false,
      rendering: false,
      downloads: distribution.archive.byteLength > 0,
      checkedAt: new Date().toISOString(),
    }),
): Hono {
  const app = new Hono();
  const editorVersion = readEditorAssetVersion();
  const editorPrefix = editorVersion && `/app/assets/editor/${editorVersion}/`;
  const editorNonces = new WeakMap<Request, string>();
  app.use("/app/projects/:id/edit/", async (c, next) => {
    editorNonces.set(c.req.raw, randomBytes(18).toString("base64"));
    await next();
  });

  app.use("*", async (c, next) => {
    await next();
    const immutable =
      c.res.status === 200 &&
      ((editorPrefix && c.req.path.startsWith(editorPrefix)) ||
        isVersionedWebFont(c.req.path));
    c.header(
      "Cache-Control",
      immutable
        ? "public, max-age=31536000, immutable"
        : "private, no-store, no-cache, max-age=0, must-revalidate, no-transform",
    );
    c.header("Cloudflare-CDN-Cache-Control", "no-store");
    c.header("CDN-Cache-Control", "no-store");
    if (!immutable) {
      c.header("Pragma", "no-cache");
      c.header("Expires", "0");
    }
  });

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: [
          "'self'",
          (c) => {
            const nonce = editorNonces.get(c.req.raw);
            return nonce === undefined ? "'self'" : `'nonce-${nonce}'`;
          },
        ],
        workerSrc: ["'self'"],
        connectSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    }),
  );

  app.get("/favicon.svg", (c) => {
    c.header("Content-Type", "image/svg+xml");
    return c.body(favicon);
  });
  app.get("/assets/styles.css", (c) => {
    c.header("Content-Type", "text/css; charset=utf-8");
    return c.body(styles);
  });
  app.get(
    "/assets/fonts/:name",
    async (c) => (await webFontAsset(c.req.param("name"))) ?? c.notFound(),
  );
  app.get("/assets/site.js", (c) => {
    c.header("Content-Type", "text/javascript; charset=utf-8");
    return c.body(readBrowserAsset("site"));
  });
  app.get("/assets/login.js", (c) => {
    c.header("Content-Type", "text/javascript; charset=utf-8");
    return c.body(readBrowserAsset("login"));
  });
  app.get("/assets/docs-search.json", (c) => {
    c.header("Content-Type", "application/json; charset=utf-8");
    return c.body(publicDocsSearchJson());
  });
  for (const locale of displayLocales) {
    app.get(`/${locale}`, (c) => c.redirect(`/${locale}/`, 308));
    app.get(`/${locale}/downloads`, (c) =>
      c.redirect(`/${locale}/downloads/`, 308),
    );
    app.get(`/${locale}/assets/docs-search.json`, (c) => {
      c.header("Content-Type", "application/json; charset=utf-8");
      return c.body(publicDocsSearchJson(locale));
    });
  }
  app.get("/admin/assets/admin.js", (c) => {
    c.header("Content-Type", "text/javascript; charset=utf-8");
    return c.body(
      localizedAdminScript(
        resolveDisplayLocale({
          selected: c.req.query("locale") ?? "ja",
        }),
      ),
    );
  });
  app.get("/admin/assets/site.js", (c) => {
    c.header("Content-Type", "text/javascript; charset=utf-8");
    return c.body(readBrowserAsset("site"));
  });
  app.get("/admin/assets/styles.css", (c) => {
    c.header("Content-Type", "text/css; charset=utf-8");
    return c.body(styles);
  });
  app.get("/admin/assets/render.js", (c) => {
    c.header("Content-Type", "text/javascript; charset=utf-8");
    return c.body(
      localizedAdminRenderScript(
        resolveDisplayLocale({ selected: c.req.query("locale") ?? "ja" }),
      ),
    );
  });
  app.get("/app/assets/app.js", (c) => {
    const locale = resolveDisplayLocale({ selected: c.req.query("locale") });
    c.header("Content-Type", "text/javascript; charset=utf-8");
    return c.body(localizedAppScript(locale));
  });
  app.get("/app/assets/site.js", (c) => {
    c.header("Content-Type", "text/javascript; charset=utf-8");
    return c.body(readBrowserAsset("site"));
  });
  app.get("/app/assets/styles.css", (c) => {
    c.header("Content-Type", "text/css; charset=utf-8");
    return c.body(styles);
  });
  app.get("/app/assets/editor.js", (c) =>
    editorAsset("editor.js", c.req.header("Accept-Encoding")),
  );
  app.get("/app/assets/editor/:version/*", (c) => {
    if (!editorPrefix || c.req.param("version") !== editorVersion)
      return c.notFound();
    return editorAsset(
      c.req.path.slice(editorPrefix.length),
      c.req.header("Accept-Encoding"),
    );
  });
  app.get("/app/assets/editor-locales/:dictionary", (c) =>
    editorAsset(
      `locales/${c.req.param("dictionary")}`,
      c.req.header("Accept-Encoding"),
    ),
  );
  app.get("/app/assets/pdf/*", (c) =>
    editorAsset(
      c.req.path.slice("/app/assets/".length),
      c.req.header("Accept-Encoding"),
    ),
  );

  app.get("/", (c) => c.html(homePage(pageLocale(c))));
  app.get("/login", (c) => c.redirect("/login/", 308));
  app.get("/login/", (c) => {
    const locale = pageLocale(c);
    return c.html(
      loginPage(locale, (choice) => {
        const query = new URL(c.req.url).searchParams;
        query.set("locale", choice);
        return `?${query}`;
      }),
    );
  });
  app.get("/render", (c) => c.redirect("/app/", 308));
  app.get("/render/", (c) => c.redirect("/app/", 308));
  for (const { url, render } of [
    ...publicDocumentationPages,
    ...localizedDocumentation.flatMap(({ pages }) => pages),
  ]) {
    app.get(url.slice(0, -1), (c) => c.redirect(url, 308));
    app.get(url, (c) => c.html(render()));
  }
  for (const locale of displayLocales) {
    app.get(`/${locale}/`, (c) => c.html(homePage(pageLocale(c, locale))));
    app.get(`/${locale}/downloads/`, (c) =>
      c.html(
        downloadsPage(
          distribution.version,
          distribution.archiveName,
          distribution.mcpbName,
          pageLocale(c, locale),
        ),
      ),
    );
  }
  app.get("/status", (c) => c.redirect("/status/", 308));
  app.get("/status/", async (c) =>
    c.html(
      statusPage(
        await statusProbe().catch(() => ({
          api: false,
          rendering: false,
          downloads: false,
          checkedAt: new Date().toISOString(),
        })),
        pageLocale(c),
      ),
    ),
  );
  app.get("/downloads", (c) => c.redirect("/downloads/", 308));
  app.get("/downloads/", (c) =>
    c.html(
      downloadsPage(
        distribution.version,
        distribution.archiveName,
        distribution.mcpbName,
        pageLocale(c),
      ),
    ),
  );

  if (
    distribution.mcpb !== undefined &&
    distribution.mcpbMetadata !== undefined &&
    distribution.mcpbName !== undefined
  ) {
    app.get("/downloads/mcpb/mcpb.json", () =>
      binaryResponse(
        distribution.mcpbMetadata as Uint8Array,
        "application/json; charset=utf-8",
      ),
    );
    app.get("/downloads/mcpb/latest.mcpb", () =>
      binaryResponse(
        distribution.mcpb as Uint8Array,
        "application/octet-stream",
        distribution.mcpbName,
      ),
    );
    app.get(`/downloads/mcpb/${distribution.mcpbName}`, () =>
      binaryResponse(
        distribution.mcpb as Uint8Array,
        "application/octet-stream",
        distribution.mcpbName,
      ),
    );
  }

  app.get("/downloads/windows/manifest.json", () =>
    binaryResponse(distribution.manifest, "application/json; charset=utf-8"),
  );
  app.get("/downloads/client/manifest.json", () =>
    binaryResponse(distribution.manifest, "application/json; charset=utf-8"),
  );
  app.get("/downloads/client/install.mjs", () =>
    binaryResponse(
      distribution.commonInstaller,
      "text/javascript; charset=utf-8",
      "install-latex-renderer.mjs",
    ),
  );
  app.get("/downloads/client/uninstall.mjs", () =>
    binaryResponse(
      distribution.commonUninstaller,
      "text/javascript; charset=utf-8",
      "uninstall-latex-renderer.mjs",
    ),
  );
  app.get("/downloads/windows/install.ps1", () =>
    binaryResponse(
      distribution.installer,
      "text/plain; charset=utf-8",
      "install-latex-renderer.ps1",
    ),
  );
  app.get("/downloads/windows/uninstall.ps1", () =>
    binaryResponse(
      distribution.uninstaller,
      "text/plain; charset=utf-8",
      "uninstall-latex-renderer.ps1",
    ),
  );
  app.get("/openapi/gateway.openapi.yaml", () =>
    binaryResponse(
      distribution.gatewayOpenApi,
      "application/yaml; charset=utf-8",
      "gateway.openapi.yaml",
    ),
  );
  app.get("/openapi/renderer.openapi.yaml", () =>
    binaryResponse(
      distribution.rendererOpenApi,
      "application/yaml; charset=utf-8",
      "renderer.openapi.yaml",
    ),
  );
  app.get("/admin/openapi/admin.openapi.yaml", () =>
    binaryResponse(
      distribution.adminOpenApi,
      "application/yaml; charset=utf-8",
      "admin.openapi.yaml",
    ),
  );
  app.get("/downloads/windows/latest.zip", () =>
    binaryResponse(
      distribution.archive,
      "application/zip",
      distribution.archiveName,
    ),
  );
  app.get("/downloads/client/latest.zip", () =>
    binaryResponse(
      distribution.archive,
      "application/zip",
      distribution.archiveName,
    ),
  );
  app.get(`/downloads/client/${distribution.archiveName}`, () =>
    binaryResponse(
      distribution.archive,
      "application/zip",
      distribution.archiveName,
    ),
  );
  app.get(`/downloads/windows/${distribution.archiveName}`, () =>
    binaryResponse(
      distribution.archive,
      "application/zip",
      distribution.archiveName,
    ),
  );

  app.get("/client", (c) => c.redirect("/downloads/", 308));
  app.get("/client/", (c) => c.redirect("/downloads/", 308));
  app.get("/client/manifest.json", (c) =>
    c.redirect("/downloads/client/manifest.json", 308),
  );
  app.get("/client/install.mjs", (c) =>
    c.redirect("/downloads/client/install.mjs", 308),
  );
  app.get("/client/uninstall.mjs", (c) =>
    c.redirect("/downloads/client/uninstall.mjs", 308),
  );
  app.get("/client/install.ps1", (c) =>
    c.redirect("/downloads/windows/install.ps1", 308),
  );
  app.get("/client/latest.zip", (c) =>
    c.redirect("/downloads/client/latest.zip", 308),
  );
  app.get(`/client/${distribution.archiveName}`, (c) =>
    c.redirect(`/downloads/client/${distribution.archiveName}`, 308),
  );

  const pages: Record<string, string> = {
    "/admin/": "dashboard",
    "/admin/users/": "users",
    "/admin/service-accounts/": "accounts",
    "/admin/api-keys/": "keys",
    "/admin/jobs/": "jobs",
    "/admin/sources/": "sources",
    "/admin/tex-environment/": "tex",
    "/admin/updates/": "updates",
    "/admin/system/": "system",
    "/admin/audit-logs/": "audit",
  };
  app.get("/admin", (c) => c.redirect("/admin/", 308));
  app.get("/admin/tex-environment", (c) =>
    c.redirect("/admin/tex-environment/", 308),
  );
  app.get("/admin/updates", (c) => c.redirect("/admin/updates/", 308));
  app.get("/admin/docs", (c) => c.redirect("/admin/docs/", 308));
  app.get("/admin/docs/", (c) => c.html(adminDocsPage(pageLocale(c))));
  app.get("/admin/render", (c) =>
    c.redirect("/admin/render/" + new URL(c.req.url).search, 308),
  );
  app.get("/admin/render/", (c) => c.html(adminRenderPage(pageLocale(c))));
  for (const [path, page] of Object.entries(pages))
    app.get(path, (c) => c.html(adminPage(page, pageLocale(c))));

  app.get("/app", (c) => c.redirect("/app/", 308));
  app.get("/app/", (c) => c.html(appRenderPage(pageLocale(c))));
  app.get("/app/history", (c) => c.redirect("/app/history/", 308));
  app.get("/app/history/", (c) => c.html(appHistoryPage(pageLocale(c))));
  app.get("/app/projects", (c) => c.redirect("/app/projects/", 308));
  app.get("/app/projects/", (c) => c.html(appProjectsPage(pageLocale(c))));
  app.get("/app/projects/:id", (c) =>
    c.redirect(`/app/projects/${encodeURIComponent(c.req.param("id"))}/`, 308),
  );
  app.get("/app/projects/:id/", (c) => c.html(appProjectPage(pageLocale(c))));
  app.get("/app/projects/:id/edit", (c) => c.redirect(`${c.req.path}/`, 308));
  app.get("/app/projects/:id/edit/", (c) => {
    const id = c.req.param("id");
    if (!/^project_[a-f0-9]{32}$/.test(id)) return c.notFound();
    return c.html(
      appProjectEditorPage(
        id,
        editorNonces.get(c.req.raw) ?? "",
        editorVersion,
        pageLocale(c),
      ),
    );
  });
  app.get("/app/jobs/:id", (c) =>
    c.redirect(`/app/jobs/${encodeURIComponent(c.req.param("id"))}/`, 308),
  );
  app.get("/app/jobs/:id/", (c) => c.html(appJobPage(pageLocale(c))));
  app.get("/app/environment", (c) => c.redirect("/app/environment/", 308));
  app.get("/app/environment/", (c) =>
    c.html(appEnvironmentPage(pageLocale(c))),
  );

  app.get("/health", (c) => c.json({ status: "ok" }));
  app.notFound((c) => c.html(publicPage404(pageLocale(c)), 404));
  return app;
}
