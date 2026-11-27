import { readFileSync } from "node:fs";

export const favicon = readFileSync(
  new URL("../public/favicon.svg", import.meta.url),
  "utf8",
);
