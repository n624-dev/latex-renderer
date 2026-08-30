import { loginScript } from "./assets/login-script.js";
import { siteScript } from "./assets/site-script.js";
import { styles } from "./assets/styles.js";
import type { ClientDistribution } from "./client-distribution.js";
import { publicDocumentationPages } from "./docs-pages.js";
import { publicDocsSearchJson } from "./markdown-docs.js";
import { downloadsPage, homePage, publicPage404 } from "./templates.js";

export interface StaticAsset {
  path: string;
  content: string | Uint8Array;
}

function headers(archiveName: string, mcpbName?: string): string {
  return `/*
  Cache-Control: public, max-age=0, must-revalidate, no-transform
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
  Permissions-Policy: camera=(), geolocation=(), microphone=()
  Referrer-Policy: no-referrer
  X-LaTeX-Renderer-Serving: workers-static
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY

/downloads/windows/manifest.json
  Content-Type: application/json; charset=utf-8

/downloads/windows/*.ps1
  Content-Type: text/plain; charset=utf-8
  Content-Disposition: attachment

/downloads/windows/latest.zip
  Content-Type: application/zip
  Content-Disposition: attachment; filename="${archiveName}"

/downloads/windows/${archiveName}
  Content-Type: application/zip
  Content-Disposition: attachment; filename="${archiveName}"

/downloads/client/manifest.json
  Content-Type: application/json; charset=utf-8

/downloads/client/*.mjs
  Content-Type: text/javascript; charset=utf-8
  Content-Disposition: attachment

/downloads/client/latest.zip
  Content-Type: application/zip
  Content-Disposition: attachment; filename="${archiveName}"

/downloads/client/${archiveName}
  Content-Type: application/zip
  Content-Disposition: attachment; filename="${archiveName}"
${mcpbName === undefined ? "" : `
/downloads/mcpb/*.mcpb
  Content-Type: application/octet-stream
  Content-Disposition: attachment; filename="${mcpbName}"

/downloads/mcpb/mcpb.json
  Content-Type: application/json; charset=utf-8
`}

/openapi/*.yaml
  Content-Type: application/yaml; charset=utf-8
  Content-Disposition: attachment
`;
}

function redirects(archiveName: string): string {
  const docRedirects = publicDocumentationPages
    .filter(({ slug }) => slug !== "index")
    .map(({ slug }) => `/docs/${slug} /docs/${slug}/ 308`)
    .join("\n");
  return `/docs /docs/ 308
${docRedirects}
/downloads /downloads/ 308
/client /downloads/ 308
/client/ /downloads/ 308
/client/manifest.json /downloads/client/manifest.json 308
/client/install.mjs /downloads/client/install.mjs 308
/client/uninstall.mjs /downloads/client/uninstall.mjs 308
/client/install.ps1 /downloads/windows/install.ps1 308
/client/latest.zip /downloads/client/latest.zip 308
/client/${archiveName} /downloads/client/${archiveName} 308
`;
}

export function createPublicStaticAssets(
  distribution: ClientDistribution,
): readonly StaticAsset[] {
  return [
    { path: "index.html", content: homePage() },
    ...publicDocumentationPages.map(({ slug, render }) => ({
      path: slug === "index" ? "docs/index.html" : `docs/${slug}/index.html`,
      content: render(),
    })),
    { path: "assets/docs-search.json", content: publicDocsSearchJson() },
    {
      path: "downloads/index.html",
      content: downloadsPage(
        distribution.version,
        distribution.archiveName,
        distribution.mcpbName,
      ),
    },
    {
      path: "downloads/client/manifest.json",
      content: distribution.manifest,
    },
    {
      path: "downloads/client/install.mjs",
      content: distribution.commonInstaller,
    },
    {
      path: "downloads/client/uninstall.mjs",
      content: distribution.commonUninstaller,
    },
    {
      path: "downloads/client/latest.zip",
      content: distribution.archive,
    },
    {
      path: `downloads/client/${distribution.archiveName}`,
      content: distribution.archive,
    },
    {
      path: "downloads/windows/manifest.json",
      content: distribution.manifest,
    },
    {
      path: "downloads/windows/install.ps1",
      content: distribution.installer,
    },
    {
      path: "downloads/windows/uninstall.ps1",
      content: distribution.uninstaller,
    },
    {
      path: "downloads/windows/latest.zip",
      content: distribution.archive,
    },
    {
      path: `downloads/windows/${distribution.archiveName}`,
      content: distribution.archive,
    },
    ...(distribution.mcpb === undefined ||
    distribution.mcpbMetadata === undefined ||
    distribution.mcpbName === undefined
      ? []
      : [
          { path: "downloads/mcpb/mcpb.json", content: distribution.mcpbMetadata },
          { path: "downloads/mcpb/latest.mcpb", content: distribution.mcpb },
          {
            path: `downloads/mcpb/${distribution.mcpbName}`,
            content: distribution.mcpb,
          },
        ]),
    {
      path: "openapi/gateway.openapi.yaml",
      content: distribution.gatewayOpenApi,
    },
    {
      path: "openapi/renderer.openapi.yaml",
      content: distribution.rendererOpenApi,
    },
    { path: "404.html", content: publicPage404() },
    { path: "assets/login.js", content: loginScript },
    { path: "assets/styles.css", content: styles },
    { path: "assets/site.js", content: siteScript },
    {
      path: "_headers",
      content: headers(distribution.archiveName, distribution.mcpbName),
    },
    { path: "_redirects", content: redirects(distribution.archiveName) },
  ];
}
