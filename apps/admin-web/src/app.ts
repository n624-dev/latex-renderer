import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { adminScript } from "./assets/admin-script.js";
import { appScript } from "./assets/app-script.js";
import { siteScript } from "./assets/site-script.js";
import { renderScript } from "./assets/render-script.js";
import { loginScript } from "./assets/login-script.js";
import { styles } from "./assets/styles.js";
import type { StatusProbe } from "./status-probe.js";
import {
  binaryResponse,
  type ClientDistribution,
} from "./client-distribution.js";
import { publicDocumentationPages } from "./docs-pages.js";
import { publicDocsSearchJson } from "./markdown-docs.js";
import {
  adminPage,
  adminDocsPage,
  appEnvironmentPage,
  appHistoryPage,
  appJobPage,
  appProjectPage,
  appProjectsPage,
  appRenderPage,
  downloadsPage,
  homePage,
  loginPage,
  publicPage404,
  statusPage,
} from "./templates.js";

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

  app.use("*", async (c, next) => {
    c.header(
      "Cache-Control",
      "private, no-store, no-cache, max-age=0, must-revalidate, no-transform",
    );
    c.header("Cloudflare-CDN-Cache-Control", "no-store");
    c.header("CDN-Cache-Control", "no-store");
    c.header("Pragma", "no-cache");
    c.header("Expires", "0");
    await next();
  });

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        connectSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    }),
  );

  app.get("/assets/styles.css", (c) => {
    c.header("Content-Type", "text/css; charset=utf-8");
    return c.body(styles);
  });
  app.get("/assets/site.js", (c) => {
    c.header("Content-Type", "text/javascript; charset=utf-8");
    return c.body(siteScript);
  });
  app.get("/assets/login.js", (c) => {
    c.header("Content-Type", "text/javascript; charset=utf-8");
    return c.body(loginScript);
  });
  app.get("/assets/docs-search.json", (c) => {
    c.header("Content-Type", "application/json; charset=utf-8");
    return c.body(publicDocsSearchJson());
  });
  app.get("/admin/assets/admin.js", (c) => {
    c.header("Content-Type", "text/javascript; charset=utf-8");
    return c.body(adminScript);
  });
  app.get("/admin/assets/site.js", (c) => {
    c.header("Content-Type", "text/javascript; charset=utf-8");
    return c.body(siteScript);
  });
  app.get("/admin/assets/styles.css", (c) => {
    c.header("Content-Type", "text/css; charset=utf-8");
    return c.body(styles);
  });
  app.get("/admin/assets/render.js", (c) => {
    c.header("Content-Type", "text/javascript; charset=utf-8");
    return c.body(renderScript);
  });
  app.get("/app/assets/app.js", (c) => {
    c.header("Content-Type", "text/javascript; charset=utf-8");
    return c.body(appScript);
  });
  app.get("/app/assets/site.js", (c) => {
    c.header("Content-Type", "text/javascript; charset=utf-8");
    return c.body(siteScript);
  });
  app.get("/app/assets/styles.css", (c) => {
    c.header("Content-Type", "text/css; charset=utf-8");
    return c.body(styles);
  });

  app.get("/", (c) => c.html(homePage()));
  app.get("/login", (c) => c.redirect("/login/", 308));
  app.get("/login/", (c) => c.html(loginPage()));
  app.get("/render", (c) => c.redirect("/app/", 308));
  app.get("/render/", (c) => c.redirect("/app/", 308));
  app.get("/docs", (c) => c.redirect("/docs/", 308));
  for (const { slug, render } of publicDocumentationPages) {
    if (slug === "index") {
      app.get("/docs/", (c) => c.html(render()));
      continue;
    }
    app.get(`/docs/${slug}`, (c) => c.redirect(`/docs/${slug}/`, 308));
    app.get(`/docs/${slug}/`, (c) => c.html(render()));
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
    binaryResponse(distribution.archive, "application/zip", distribution.archiveName),
  );
  app.get("/downloads/client/latest.zip", () =>
    binaryResponse(distribution.archive, "application/zip", distribution.archiveName),
  );
  app.get(`/downloads/client/${distribution.archiveName}`, () =>
    binaryResponse(distribution.archive, "application/zip", distribution.archiveName),
  );
  app.get(`/downloads/windows/${distribution.archiveName}`, () =>
    binaryResponse(distribution.archive, "application/zip", distribution.archiveName),
  );

  app.get("/client", (c) => c.redirect("/downloads/", 308));
  app.get("/client/", (c) => c.redirect("/downloads/", 308));
  app.get("/client/manifest.json", (c) => c.redirect("/downloads/client/manifest.json", 308));
  app.get("/client/install.mjs", (c) => c.redirect("/downloads/client/install.mjs", 308));
  app.get("/client/uninstall.mjs", (c) => c.redirect("/downloads/client/uninstall.mjs", 308));
  app.get("/client/install.ps1", (c) => c.redirect("/downloads/windows/install.ps1", 308));
  app.get("/client/latest.zip", (c) => c.redirect("/downloads/client/latest.zip", 308));
  app.get(`/client/${distribution.archiveName}`, (c) => c.redirect(`/downloads/client/${distribution.archiveName}`, 308));

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
  app.get("/admin/tex-environment", (c) => c.redirect("/admin/tex-environment/", 308));
  app.get("/admin/updates", (c) => c.redirect("/admin/updates/", 308));
  app.get("/admin/docs", (c) => c.redirect("/admin/docs/", 308));
  app.get("/admin/docs/", (c) => c.html(adminDocsPage()));
  app.get("/admin/render", (c) => c.redirect("/app/", 308));
  app.get("/admin/render/", (c) => c.redirect("/app/", 308));
  for (const [path, page] of Object.entries(pages))
    app.get(path, (c) => c.html(adminPage(page)));

  app.get("/app", (c) => c.redirect("/app/", 308));
  app.get("/app/", (c) => c.html(appRenderPage()));
  app.get("/app/history", (c) => c.redirect("/app/history/", 308));
  app.get("/app/history/", (c) => c.html(appHistoryPage()));
  app.get("/app/projects", (c) => c.redirect("/app/projects/", 308));
  app.get("/app/projects/", (c) => c.html(appProjectsPage()));
  app.get("/app/projects/:id", (c) => c.redirect(`/app/projects/${encodeURIComponent(c.req.param("id"))}/`, 308));
  app.get("/app/projects/:id/", (c) => c.html(appProjectPage()));
  app.get("/app/jobs/:id", (c) => c.redirect(`/app/jobs/${encodeURIComponent(c.req.param("id"))}/`, 308));
  app.get("/app/jobs/:id/", (c) => c.html(appJobPage()));
  app.get("/app/environment", (c) => c.redirect("/app/environment/", 308));
  app.get("/app/environment/", (c) => c.html(appEnvironmentPage()));

  app.get("/health", (c) => c.json({ status: "ok" }));
  app.notFound((c) => c.html(publicPage404(), 404));
  return app;
}
