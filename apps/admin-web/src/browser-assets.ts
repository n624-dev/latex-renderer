import { readFileSync } from "node:fs";

type BrowserAsset = "admin-render" | "app" | "login" | "site";

const scripts = new Map<BrowserAsset, string>();

export function readBrowserAsset(name: BrowserAsset): string {
  const cached = scripts.get(name);
  if (cached !== undefined) return cached;
  const path = new URL(`../dist/browser-assets/${name}.js`, import.meta.url);
  const script = readFileSync(path, "utf8");
  scripts.set(name, script);
  return script;
}
