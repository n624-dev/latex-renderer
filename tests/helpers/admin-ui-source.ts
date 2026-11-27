import { readFileSync } from "node:fs";
import { adminCatalog } from "../../apps/admin-web/src/admin-messages.js";

const root = new URL("../../apps/admin-web/src/browser/admin/", import.meta.url);
function source(name: string): string {
  return readFileSync(new URL(name, root), "utf8");
}

// Isolated view fixtures inject a small DOM, API, and catalog. The end-to-end
// suites separately load the bundled entrypoint through the real page.
function feature(name: string): string {
  const file = source(name + ".js");
  return file.slice(file.indexOf("}) {\n") + 5, file.lastIndexOf("\n  return { "));
}
export const jobViewSource = feature("jobs");
export const keyViewSource = feature("keys");
export const texViewSource = feature("tex");
export const updateViewSource = feature("updates");
export const adminSource = [
  JSON.stringify(adminCatalog("ja")),
  source("controller.ts"),
  source("dashboard.ts"),
  ...["controls", "users", "keys", "jobs", "tex", "updates", "system"].map(feature),
].join("\n");
