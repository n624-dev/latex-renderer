import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { adminCatalog } from "../../apps/admin-web/src/admin-messages.js";
import {
  formText,
  requireElement,
  required,
} from "../../apps/admin-web/src/browser/admin/view.js";

const root = new URL(
  "../../apps/admin-web/src/browser/admin/",
  import.meta.url,
);
const features = ["controls", "users", "keys", "jobs", "tex", "updates"];
function source(name: string): string {
  return readFileSync(new URL(name, root), "utf8");
}

// Isolated view fixtures inject a small DOM, API, and catalog. The end-to-end
// suites separately load the bundled entrypoint through the real page.
function feature(name: string): string {
  const file = source(name + ".ts");
  const start = file.indexOf(") {\n", file.indexOf("export function create"));
  const end = file.lastIndexOf("\n  return { ");
  if (start < 0 || end < start) throw new Error("Missing admin view " + name);
  const helpers = { required, requireElement, formText };
  return [
    stripTypeScriptTypes(file.slice(start + 4, end)),
    ...Object.entries(helpers).map(
      ([key, helper]) => `const ${key} = ${helper.toString()};`,
    ),
  ].join("\n");
}
export const jobViewSource = feature("jobs");
export const keyViewSource = feature("keys");
export const texViewSource = feature("tex");
export const updateViewSource = feature("updates");
export const adminSource = [
  JSON.stringify(adminCatalog("ja")),
  source("controller.ts"),
  source("dashboard.ts"),
  ...features.map((name) => source(name + ".ts")),
  source("system.js"),
].join("\n");
