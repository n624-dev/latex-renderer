import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { validateEntrypointPath, validateSourceFilePath } from "@latex-renderer/zip-validation";

for (const [name, validate] of [
  ["entrypoint", validateEntrypointPath],
  ["source file", validateSourceFilePath],
] as const) {
  describe(`${name} UTF-8 filename limits`, () => {
    for (const path of [
      `${"あ".repeat(84)}.tex`,
      `${"😀".repeat(63)}.tex`,
      `${"あ".repeat(86)}/main.tex`,
    ]) {
      it(`rejects an overlong component (${Buffer.byteLength(path, "utf8")} path bytes)`, () => {
        assert.throws(() => validate(path), { code: "ZIP_UNSAFE_NAME", status: 422 });
      });
    }
    for (const path of [
      "Main.TEX",
      `${"あ".repeat(83)}aa.tex`,
      `${"あ".repeat(85)}/main.tex`,
    ]) {
      it(`accepts a bounded component (${Buffer.byteLength(path, "utf8")} path bytes)`, () => {
        assert.equal(validate(path), path);
      });
    }
  });
}
