import { readdir } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  pipelineDocument,
  sourcePipelineFixture,
} from "./helpers/source-pipeline.js";

it("validates highly compressible inline content before reserving a Source or Job", async () => {
  const f = await sourcePipelineFixture({
    maxUploadBytes: 1024,
    maxExtractedBytes: 2048,
  });
  const identity = {
    userId: "pipeline_user",
    scopes: ["mcp:render", "mcp:read"] as const,
  };
  try {
    const before = await readdir(f.storage);
    const content = pipelineDocument() + "%".repeat(2457);
    await expect(
      f.renders.createSource(identity, [{ path: "main.tex", text: content }]),
    ).rejects.toMatchObject({ code: "SOURCE_FILE_SIZE" });
    await expect(
      f.renders.createRender(identity, { inlineSource: content }),
    ).rejects.toMatchObject({ code: "SOURCE_FILE_SIZE" });
    expect(
      f.database.raw.prepare("SELECT COUNT(*) AS n FROM sources").get(),
    ).toEqual({ n: 0 });
    expect(
      f.database.raw.prepare("SELECT COUNT(*) AS n FROM jobs").get(),
    ).toEqual({ n: 0 });
    expect(await readdir(f.storage)).toEqual(before);
    // The same exact file-size boundary is accepted by both producers.
    const boundary = pipelineDocument().padEnd(1024, "%");
    const direct = await f.renders.createSource(identity, [
      { path: "main.tex", text: boundary },
    ]);
    const inline = await f.renders.createRender(identity, {
      inlineSource: boundary,
    });
    expect(direct.status).toBe("ready");
    expect(inline.status).toBe("queued");
    await expect(
      f.renders.createRender(identity, { inlineSource: boundary + "%" }),
    ).rejects.toMatchObject({ code: "SOURCE_FILE_SIZE" });
  } finally {
    await f.close();
  }
});

it("rejects oversized ZIP metadata and the fixed 64KiB inline boundary without leaving files", async () => {
  for (const uploadLimit of [100, 128 * 1024]) {
    const f = await sourcePipelineFixture({
      maxUploadBytes: uploadLimit,
      maxExtractedBytes: 128 * 1024,
    });
    const identity = {
      userId: "pipeline_user",
      scopes: ["mcp:render", "mcp:read"] as const,
    };
    try {
      const before = await readdir(f.storage);
      await expect(
        f.renders.createRender(identity, {
          inlineSource: uploadLimit === 100 ? "x" : "%".repeat(64 * 1024 + 1),
        }),
      ).rejects.toMatchObject({
        code:
          uploadLimit === 100 ? "SOURCE_ARCHIVE_SIZE" : "INLINE_SOURCE_SIZE",
      });
      expect(
        f.database.raw.prepare("SELECT COUNT(*) AS n FROM sources").get(),
      ).toEqual({ n: 0 });
      expect(
        f.database.raw.prepare("SELECT COUNT(*) AS n FROM jobs").get(),
      ).toEqual({ n: 0 });
      expect(await readdir(f.storage)).toEqual(before);
    } finally {
      await f.close();
    }
  }
});
