import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sourcePipelineFixture,
  pipelineDocument,
} from "./helpers/source-pipeline.js";
import {
  prepareSourceInput,
  collectSourceTrees,
  recoverSourceTreeReaders,
} from "../apps/renderer-worker/src/source-tree-cache.js";
import * as docker from "../apps/renderer-worker/src/docker.js";
import type { SourceTreeRow } from "@latex-renderer/database";
afterEach(() => vi.restoreAllMocks());
const identity = {
  userId: "pipeline_user",
  scopes: ["mcp:render", "mcp:read"] as const,
};
async function fixture() {
  const f = await sourcePipelineFixture();
  try {
    Object.assign(f.config, {
      sourceTreeMaxBytes: 2 * 1024 ** 2,
      sourceTreeUserMaxBytes: 1024 ** 2,
      maxUserStorageBytes: 20 * 1024 ** 2,
      sourceTreeTtlMs: 60000,
    });
    const source = await f.renders.createSource(identity, [
      { path: "main.tex", text: pipelineDocument() },
      { path: "other.tex", text: pipelineDocument(1, "Other") },
    ]);
    const next = async (entrypoint = "main.tex") => {
      const job = await f.renders.createRender(identity, {
        sourceId: source.id,
        entrypoint,
      });
      const claimed = f.database.worker.claimNext(
        f.config.workerId,
        new Date().toISOString(),
        new Date(Date.now() + 30000).toISOString(),
      );
      if (!claimed || claimed.id !== job.id)
        throw new Error("Missing fixture claim");
      const destination = join(f.root, `input-${job.id}`);
      return {
        job: claimed,
        destination,
        prepare: () =>
          prepareSourceInput(
            f.database,
            f.config,
            claimed,
            join(f.storage, "sources", source.id, "source.zip"),
            destination,
          ),
      };
    };
    const rows = () =>
      f.database.raw
        .prepare("SELECT * FROM source_trees ORDER BY id")
        .all() as unknown as SourceTreeRow[];
    return { ...f, source, next, rows };
  } catch (error) {
    await f.close();
    throw error;
  }
}
describe("bounded owner-bound Source input reuse (fixture renderer, no Docker)", () => {
  it("collects unpinned inputs after lowering the configured budget without starting another Job", async () => {
    const f = await fixture();
    try {
      const a = await f.next(),
        first = await a.prepare();
      await collectSourceTrees(f.database.raw, f.storage, false, 32, 0);
      expect(f.rows()).toHaveLength(1);
      first.release();
      await collectSourceTrees(f.database.raw, f.storage, false, 32, 0);
      expect(f.rows()).toHaveLength(0);
    } finally {
      await f.close();
    }
  });
  it("promotes without duplicating per-Job input and reuses bytes/names/modes for another entrypoint", async () => {
    const f = await fixture();
    try {
      const a = await f.next(),
        first = await a.prepare(),
        before = await lstat(join(first.input, "main.tex")),
        row = f.rows()[0]!;
      expect(first.hit).toBe(false);
      expect(first.input).not.toBe(a.destination);
      await expect(lstat(a.destination)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(
        f.database.jobs.storageUsageForUser(identity.userId),
      ).toBeGreaterThanOrEqual(row.reserved_bytes);
      const b = await f.next("other.tex"),
        second = await b.prepare();
      expect(second.hit).toBe(true);
      expect(second.input).toBe(first.input);
      expect(await lstat(join(second.input, "main.tex"))).toMatchObject({
        ino: before.ino,
        mode: before.mode,
        mtimeMs: before.mtimeMs,
        nlink: 1,
      });
      const args = docker.rendererRunArguments(
        f.config,
        b.job.id,
        second.input,
        "/private/output",
        b.job.entrypoint,
        ["pdf"],
        b.job.lease_generation,
      );
      expect(args).toContain(
        `type=bind,src=${first.input},dst=/work/input,readonly`,
      );
      expect(f.database.sourceTrees.readers()).toHaveLength(2);
      await collectSourceTrees(f.database.raw, f.storage, true);
      expect(f.rows()).toHaveLength(1);
      first.release();
      second.release();
      second.release();
      expect(f.rows()[0]!.expires_at).toBe(row.expires_at);
      await collectSourceTrees(f.database.raw, f.storage, true);
      expect(f.rows()).toHaveLength(0);
      await expect(lstat(first.input)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await f.close();
    }
  });
  it.each(["content", "missing", "manifest", "limits"])(
    "falls back to complete ZIP validation after %s changes",
    async (mode) => {
      const f = await fixture();
      try {
        const a = await f.next(),
          first = await a.prepare(),
          row = f.rows()[0]!;
        first.release();
        if (mode === "content")
          await writeFile(join(first.input, "main.tex"), "corrupted");
        if (mode === "missing") await rm(first.input, { recursive: true });
        if (mode === "manifest")
          f.database.raw
            .prepare("UPDATE source_trees SET manifest_json='{}' WHERE id=?")
            .run(row.id);
        if (mode === "limits") f.config.maxZipEntries--;
        const b = await f.next(),
          second = await b.prepare();
        expect(second.hit).toBe(false);
        expect(await readFile(join(second.input, "main.tex"), "utf8")).toBe(
          pipelineDocument(),
        );
        second.release();
      } finally {
        await f.close();
      }
    },
  );
  it.each(["global", "user", "quota"])(
    "keeps ordinary extraction when %s capacity is exhausted",
    async (kind) => {
      const f = await fixture();
      try {
        if (kind === "global") f.config.sourceTreeMaxBytes = 1;
        if (kind === "user") f.config.sourceTreeUserMaxBytes = 1;
        if (kind === "quota") f.config.maxUserStorageBytes = 1;
        const a = await f.next(),
          first = await a.prepare();
        expect(first.input).toBe(a.destination);
        expect(f.rows()).toHaveLength(0);
        expect(await readFile(join(first.input, "main.tex"), "utf8")).toBe(
          pipelineDocument(),
        );
      } finally {
        await f.close();
      }
    },
  );
  it("isolates an owned tree from foreign users and rejects a mismatched Job/Source binding", async () => {
    const f = await fixture();
    try {
      const a = await f.next(),
        first = await a.prepare(),
        row = f.rows()[0]!;
      expect(
        f.database.sourceTrees.acquire(
          row.identity,
          "pipeline_other",
          a.job.id,
          a.job.lease_generation,
          new Date().toISOString(),
        ),
      ).toBeUndefined();
      await expect(
        prepareSourceInput(
          f.database,
          f.config,
          { ...a.job, source_sha256: "0".repeat(64) },
          join(f.storage, "sources", f.source.id, "source.zip"),
          join(f.root, "foreign"),
        ),
      ).rejects.toMatchObject({ code: "SOURCE_NOT_READY" });
      first.release();
    } finally {
      await f.close();
    }
  });
  it("rejects changed ZIP bytes rather than caching or rendering unverified data", async () => {
    const f = await fixture();
    try {
      const a = await f.next();
      await writeFile(
        join(f.storage, "sources", f.source.id, "source.zip"),
        "invalid",
      );
      await expect(a.prepare()).rejects.toMatchObject({
        code: "SOURCE_CHECKSUM_INVALID",
      });
      expect(f.rows()).toHaveLength(0);
    } finally {
      await f.close();
    }
  });
  it("preserves pins after a killed Worker until exact daemon-stop proof, then collects abandoned building data", async () => {
    const f = await fixture();
    try {
      const a = await f.next(),
        first = await a.prepare();
      f.database.raw.exec(
        "UPDATE source_trees SET status='building',expires_at='2000-01-01'; UPDATE jobs SET lease_expires_at='2000-01-01'",
      );
      await collectSourceTrees(f.database.raw, f.storage, true);
      expect(f.rows()).toHaveLength(1);
      const stop = vi
        .spyOn(docker, "dockerStopVerified")
        .mockRejectedValue(new Error("daemon unknown"));
      await recoverSourceTreeReaders(f.database);
      expect(stop).not.toHaveBeenCalled();
      f.database.raw.exec("UPDATE jobs SET status='queued',lease_owner=NULL");
      await recoverSourceTreeReaders(f.database);
      expect(f.database.sourceTrees.readers()).toHaveLength(1);
      stop.mockResolvedValue(undefined);
      await recoverSourceTreeReaders(f.database);
      expect(stop).toHaveBeenLastCalledWith(
        docker.rendererContainerName(a.job.id, a.job.lease_generation),
      );
      await collectSourceTrees(f.database.raw, f.storage);
      expect(f.rows()).toHaveLength(0);
      await expect(lstat(first.input)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await f.close();
    }
  });
  it("restores ordinary input after an ENOSPC publication boundary without publishing a partial tree", async () => {
    const f = await fixture();
    try {
      vi.spyOn(f.database.sourceTrees, "publish").mockImplementation(() => {
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      });
      const a = await f.next(),
        first = await a.prepare();
      expect(first.input).toBe(a.destination);
      expect(f.rows()[0]?.status).toBe("invalid");
      expect(f.database.sourceTrees.readers()).toEqual([]);
      expect(await readFile(join(first.input, "main.tex"), "utf8")).toBe(
        pipelineDocument(),
      );
      await collectSourceTrees(f.database.raw, f.storage);
      expect(f.rows()).toHaveLength(0);
    } finally {
      await f.close();
    }
  });
  it.skipIf(process.platform === "win32")(
    "never traverses an external root symlink during cache GC",
    async () => {
      const f = await fixture();
      try {
        const a = await f.next(),
          first = await a.prepare(),
          root = join(first.input, "..");
        first.release();
        const outside = join(f.root, "protected");
        await mkdir(outside);
        await writeFile(join(outside, "keep"), "keep");
        await rename(root, root + "-saved");
        await symlink(outside, root, "dir");
        await expect(
          collectSourceTrees(f.database.raw, f.storage, true),
        ).rejects.toThrow("Unsafe");
        expect(await readFile(join(outside, "keep"), "utf8")).toBe("keep");
        expect(f.rows()[0]?.status).toBe("deleting");
      } finally {
        await f.close();
      }
    },
  );
});
