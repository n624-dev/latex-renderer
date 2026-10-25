import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { validateSelfHostingVersion } from "../docs-check.js";
const paths = ["README.md", "SETUP.md", "docs/public/self-hosting.md"];
const documents = Object.fromEntries(
  paths.map((path) => [path, readFileSync(path, "utf8")]),
);
const metadata = JSON.parse(
  readFileSync("docs/self-hosting-release.json", "utf8"),
) as { version: string };
const stable = metadata.version;
const parts = stable.split(".");
const next = `${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}`;
const candidate = `${next}-rc.1`;
it("pins every current self-hosting entry to the same verified Stable", () => {
  expect(() =>
    validateSelfHostingVersion(stable, candidate, documents),
  ).not.toThrow();
  expect(() =>
    validateSelfHostingVersion(stable, stable, documents),
  ).not.toThrow();
});
it.each(paths)("detects stale version links in %s", (path) => {
  expect(() =>
    validateSelfHostingVersion(stable, candidate, {
      ...documents,
      [path]: (documents[path] ?? "").replaceAll(stable, "0.0.1"),
    }),
  ).toThrow();
});
it("rejects RCs as general installation targets and requires Stable promotion updates", () => {
  expect(() =>
    validateSelfHostingVersion(candidate, candidate, documents),
  ).toThrow();
  expect(() => validateSelfHostingVersion(stable, next, documents)).toThrow();
  expect(() =>
    validateSelfHostingVersion(stable, candidate, {
      ...documents,
      "docs/public/self-hosting.md": (
        documents["docs/public/self-hosting.md"] ?? ""
      ).replace(`version=${stable}`, "version=0.0.1"),
    }),
  ).toThrow();
});
