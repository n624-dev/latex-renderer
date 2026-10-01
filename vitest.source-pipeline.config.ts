import { defineConfig } from "vitest/config";
if (process.env.SOURCE_PIPELINE_RENDERER_IMAGE === undefined)
  throw new Error(
    "Explicit Source pipeline integration mode requires a pinned renderer image",
  );
export default defineConfig({
  test: {
    include: ["tests/source-pipeline-e2e.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
