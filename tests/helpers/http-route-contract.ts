import { readFileSync } from "node:fs";
import { openApiOperations as parseOpenApiOperations } from "../../apps/admin-web/src/docs-validation.js";

export function normalizedRoute(path: string): string {
  return path.replace(/\{[^}]+\}|:[\w]+|\*$/g, "{}").replace(/\/$/, "");
}

export function openApiOperations(filename: string) {
  return parseOpenApiOperations(readFileSync(filename, "utf8"));
}
