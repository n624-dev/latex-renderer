import { describe, expect, it } from "vitest";
import {
  homePage,
  downloadsPage,
  statusPage,
} from "../apps/admin-web/src/templates-pages.js";
import { setupStyle } from "../deploy/scripts/server-setup-assets.mjs";

describe("concise public UI", () => {
  it("keeps the account requirement and entry points without decorative headings", () => {
    const html = homePage();
    expect(html).not.toContain('class="eyebrow"');
    expect(html).toContain("管理者が用意したアカウント");
    for (const path of [
      "/app/",
      "/downloads/",
      "/docs/",
      "/docs/web/",
      "/docs/integrations/",
      "/docs/api/",
    ]) {
      expect(html).toContain(`href="${path}"`);
    }
    expect(html.match(/href="\/"/g)).toHaveLength(1);
  });

  it("retains latest and exact-version downloads while moving detailed instructions to docs", () => {
    const html = downloadsPage(
      "1.2.3",
      "client-1.2.3.zip",
      "extension-1.2.3.mcpb",
    );
    for (const path of [
      "client/install.mjs",
      "client/latest.zip",
      "client/client-1.2.3.zip",
      "mcpb/latest.mcpb",
      "mcpb/extension-1.2.3.mcpb",
    ]) {
      expect(html).toContain(`href="/downloads/${path}"`);
    }
    expect(html).toContain("クライアント 1.2.3");
    expect(html).toContain('href="/docs/client/"');
    expect(html).toContain('href="/docs/security/"');
    expect(html).not.toContain('class="eyebrow"');
    expect(html).not.toContain("DPAPI");
    expect(downloadsPage("1.2.3", "client.zip")).not.toContain(
      "/downloads/mcpb/",
    );
  });

  it("keeps availability and check time without prescribing API keys to Web users", () => {
    const html = statusPage({
      api: true,
      rendering: false,
      downloads: true,
      checkedAt: "2026-10-19T00:00:00.000Z",
    });
    expect(html).toContain("レンダリング処理：停止または確認不可");
    expect(html).toContain('datetime="2026-10-19T00:00:00.000Z"');
    expect(html).toContain('href="/docs/troubleshooting/"');
    expect(html).not.toContain("APIキーを確認");
    expect(html).not.toContain('class="eyebrow"');
  });

  it("gives hidden setup controls precedence over grid and checkbox label layouts", () => {
    expect(setupStyle).toContain("[hidden] { display:none !important; }");
    expect(setupStyle).toContain("label { display:grid;");
  });
});
