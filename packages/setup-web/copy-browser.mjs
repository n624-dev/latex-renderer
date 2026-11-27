import { copyFile } from "node:fs/promises";
import { URL } from "node:url";

await copyFile(
  new URL("./src/setup-browser.js", import.meta.url),
  new URL("./dist/setup-browser.js", import.meta.url),
);
