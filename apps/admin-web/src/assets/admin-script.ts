import type { DisplayLocale } from "@latex-renderer/shared/locale";
import { adminCatalog } from "../admin-messages.js";
import { readBrowserAsset } from "../browser-assets.js";

export function localizedAdminScript(locale: DisplayLocale): string {
  return `(() => {
${readBrowserAsset("admin")}
rendererAdminController.installAdmin(${JSON.stringify(adminCatalog(locale))});
})();\n`;
}
