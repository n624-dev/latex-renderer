import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  diagnosticWriter,
  pruneServiceDiagnostics,
} from "../deploy/scripts/service-diagnostics.mjs";
const roots: string[] = [];
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
function root() {
  const p = mkdtempSync(join(tmpdir(), "service-diagnostics-"));
  roots.push(p);
  return p;
}
describe("bounded service diagnostics", () => {
  it("retains typed Draft Preview timings without retaining source paths", async () => {
    const p = root();
    const log = diagnosticWriter(p, "renderer-worker");
    log({
      event: "renderer_worker.draft_preview_completed",
      queueAndPrepareMs: 17,
      sourcePrepareMs: 10,
      compileMs: 1500,
      validationMs: 4,
      publishMs: 2,
      workCacheHit: false,
      path: "main.tex",
    });
    log({
      event: "renderer_worker.draft_preview_completed",
      compileMs: "main.tex",
      validationMs: -1,
      workCacheHit: "unknown",
    });
    await log.flush();
    const lines = readFileSync(
      join(p, "diagnostics/renderer-worker.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n");
    expect(JSON.parse(lines[0] ?? "") as unknown).toMatchObject({
      queueAndPrepareMs: 17,
      sourcePrepareMs: 10,
      compileMs: 1500,
      validationMs: 4,
      publishMs: 2,
      workCacheHit: false,
    });
    expect(lines.join("\n")).not.toContain("main.tex");
    expect(JSON.parse(lines[1] ?? "") as unknown).not.toHaveProperty(
      "validationMs",
    );
  });

  it("writes bounded JSON and rotates instead of accumulating files", async () => {
    const p = root(),
      log = diagnosticWriter(p, "remote-mcp");
    log({ event: "test" });
    await log.flush();
    const path = join(p, "diagnostics/remote-mcp.jsonl");
    const header =
      JSON.stringify({ time: new Date().toISOString(), event: "fixture" }) +
      "\n";
    writeFileSync(
      path,
      header + "x".repeat(2 * 1024 * 1024 - Buffer.byteLength(header)),
    );
    log({ event: "rotated" });
    await log.flush();
    expect(JSON.parse(readFileSync(path, "utf8")) as unknown).toMatchObject({
      event: "rotated",
    });
    expect(statSync(path + ".1").size).toBe(2 * 1024 * 1024);
    expect(readdirSync(join(p, "diagnostics")).length).toBe(2);
    log({ oversized: "x".repeat(4096) });
    await log.flush();
    expect(readFileSync(path, "utf8")).not.toContain("oversized");
  });
  it("expires both files and never touches unrelated storage", async () => {
    const p = root();
    const log = diagnosticWriter(p, "renderer-worker");
    log({ event: "test" });
    await log.flush();
    const path = join(p, "diagnostics/renderer-worker.jsonl");
    utimesSync(path, 1, 1);
    writeFileSync(join(p, "diagnostics/keep.txt"), "keep");
    expect(await pruneServiceDiagnostics(p)).toBe(1);
    expect(readdirSync(join(p, "diagnostics"))).toEqual(["keep.txt"]);
  });
  it("expires old records even when recent writes keep the file mtime fresh", async () => {
    const p = root();
    const log = diagnosticWriter(p, "remote-mcp");
    log({ event: "test" });
    await log.flush();
    const path = join(p, "diagnostics/remote-mcp.jsonl");
    writeFileSync(
      path,
      JSON.stringify({
        time: new Date(Date.now() - 8 * 86400000).toISOString(),
        event: "old",
      }) + "\n",
    );
    expect(await pruneServiceDiagnostics(p)).toBe(1);
  });
  it.skipIf(process.platform === "win32")(
    "rejects external symlinks without modifying their targets",
    async () => {
      const p = root(),
        outside = root();
      const log = diagnosticWriter(p, "remote-mcp");
      log({ event: "test" });
      await log.flush();
      const target = join(outside, "keep");
      writeFileSync(target, "keep");
      const path = join(p, "diagnostics/remote-mcp.jsonl");
      rmSync(path);
      symlinkSync(target, path);
      expect(() => log({ event: "blocked" })).not.toThrow();
      await log.flush();
      expect(readFileSync(target, "utf8")).toBe("keep");
      await expect(pruneServiceDiagnostics(p)).rejects.toThrow("Unsafe");
    },
  );
  it("bounds the in-flight queue and drops non-allowlisted fields", async () => {
    const p = root(),
      log = diagnosticWriter(p, "remote-mcp");
    for (let i = 0; i < 1000; i++)
      log({ event: "test", sequence: i, token: "DO_NOT_LOG" });
    await log.flush();
    const text = readFileSync(join(p, "diagnostics/remote-mcp.jsonl"), "utf8");
    expect(text.trim().split("\n").length).toBeLessThanOrEqual(33);
    expect(text).not.toContain("DO_NOT_LOG");
  });
});
