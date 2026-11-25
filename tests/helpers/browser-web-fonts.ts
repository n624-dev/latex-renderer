import type { Page } from "playwright";
import { webFontAsset } from "../../apps/admin-web/src/assets/font-assets.js";

export async function routeWebFonts(page: Page, origin: string): Promise<void> {
  const prefix = "/assets/fonts/";
  await page.route(
    (url) => url.origin === origin && url.pathname.startsWith(prefix),
    async (route) => {
      const name = new URL(route.request().url()).pathname.slice(prefix.length);
      const asset = await webFontAsset(name);
      if (!asset) {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: asset.status,
        headers: Object.fromEntries(asset.headers),
        body: Buffer.from(await asset.arrayBuffer()),
      });
    },
  );
}
