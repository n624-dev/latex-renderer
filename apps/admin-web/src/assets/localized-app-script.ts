import type { DisplayLocale } from "@latex-renderer/shared/locale";
import { adminCatalog } from "../admin-messages.js";
import { appCatalog } from "../app-messages.js";
import { readBrowserAsset } from "../browser-assets.js";
import type { AppBrowserConfig } from "./app-script.js";

export function appBrowserConfig(locale: DisplayLocale): AppBrowserConfig {
  const labels = adminCatalog(locale);
  return {
    messages: appCatalog(locale),
    jobActions: {
      cancel: labels.cancelJob,
      cancelConfirmation: labels.ifTheJobIsRunningA,
      canceled: labels.cancellationRequested,
      delete: labels.deleteJob,
      deleteConfirmation: labels.theInputPdfLogsAndPreviews,
      retry: labels.runAgain,
    },
  };
}

export function localizedAppScript(locale: DisplayLocale): string {
  const appController = readBrowserAsset("app");
  const config = JSON.stringify(appBrowserConfig(locale));
  return `(() => {
${appController}
void rendererAppController.installApp(${config});
})();\n`;
}
