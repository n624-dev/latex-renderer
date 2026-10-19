import { afterEach, describe, expect, it } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";
import { defined } from "./helpers/assert-defined.js";
import {
  MIB,
  memoryProfileKey,
  planRenderMemory,
  rememberRenderMemory,
  type MemoryCandidate,
} from "../apps/renderer-worker/src/memory-plan.js";

const databases: RendererDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
const image = `sha256:${"a".repeat(64)}`;
const candidate: MemoryCandidate = {
  id: "job_test",
  user_id: "owner",
  source_sha256: "b".repeat(64),
  entrypoint: "main.tex",
  outputs_json: '["pdf","svg"]',
  queued_at: new Date(0).toISOString(),
};
function fixture() {
  const db = new RendererDatabase(":memory:");
  databases.push(db);
  db.migrate();
  return { db, key: memoryProfileKey(candidate, image), now: Date.now() };
}
describe("bounded, owner/input/Runtime-specific memory planning", () => {
  it("uses a full 1GiB sandbox for unknown documents and preserves explicit host thresholds", () => {
    const { db } = fixture();
    expect(planRenderMemory(db, candidate, image, 832 * MIB)).toMatchObject({
      limit: 1024 * MIB,
      minimum: 832 * MIB,
      estimatedPeak: null,
    });
  });
  it.each([
    [191, 320, 448],
    [407, 576, 704],
    [936, 1024, 1152],
  ])(
    "bounds an observed %iMiB run with a %iMiB cap and %iMiB admission budget",
    (peak, cap, minimum) => {
      const { db, key } = fixture();
      rememberRenderMemory(db, key, peak * MIB, true);
      expect(planRenderMemory(db, candidate, image, 1152 * MIB)).toMatchObject({
        limit: cap * MIB,
        minimum: minimum * MIB,
        estimatedPeak: peak * MIB,
      });
    },
  );
  it("does not reuse another owner, source, entrypoint, output set or Runtime's estimate", () => {
    const { db, key } = fixture();
    rememberRenderMemory(db, key, 191 * MIB, true);
    for (const other of [
      { ...candidate, user_id: "other" },
      { ...candidate, source_sha256: "c".repeat(64) },
      { ...candidate, entrypoint: "other.tex" },
      { ...candidate, outputs_json: '["pdf"]' },
    ])
      expect(
        planRenderMemory(db, other, image, 1152 * MIB).estimatedPeak,
      ).toBeNull();
    expect(
      planRenderMemory(db, candidate, `sha256:${"c".repeat(64)}`, 1152 * MIB)
        .estimatedPeak,
    ).toBeNull();
    expect(
      memoryProfileKey({ ...candidate, outputs_json: '["svg","pdf"]' }, image),
    ).toBe(key);
  });
  it("does not treat an unknown, partial or invalid measurement as zero", () => {
    const { db, key } = fixture();
    for (const peak of [undefined, 0, NaN, -1, 1.2, 1025 * MIB]) {
      rememberRenderMemory(db, key, peak, true);
      expect(
        planRenderMemory(db, candidate, image, 1152 * MIB).estimatedPeak,
      ).toBeNull();
    }
  });
  it("keeps the highest observed peak and invalidates a prediction after memory exhaustion", () => {
    const { db, key } = fixture();
    rememberRenderMemory(db, key, 407 * MIB, true);
    rememberRenderMemory(db, key, 191 * MIB, true);
    expect(
      planRenderMemory(db, candidate, image, 1152 * MIB).estimatedPeak,
    ).toBe(407 * MIB);
    rememberRenderMemory(db, key, undefined, false);
    expect(
      planRenderMemory(db, candidate, image, 1152 * MIB).estimatedPeak,
    ).toBeNull();
  });
  it("expires profiles after seven days without refreshing them just by reading", () => {
    const { db, key, now } = fixture();
    rememberRenderMemory(db, key, 191 * MIB, true, now);
    expect(
      planRenderMemory(db, candidate, image, 1152 * MIB, now + 7 * 86400_000)
        .estimatedPeak,
    ).toBeNull();
  });
  it("bounds persistent records and serialized metadata", () => {
    const { db, now } = fixture();
    for (let i = 0; i < 100; i++)
      rememberRenderMemory(
        db,
        memoryProfileKey({ ...candidate, user_id: `owner${i}` }, image),
        191 * MIB,
        true,
        now + i,
      );
    const text = defined(
      db.settings.get("worker_memory_profiles_v1"),
    ).value_json;
    expect(JSON.parse(text)).toHaveLength(64);
    expect(text.length).toBeLessThan(16384);
  });
  it.each(["{", "null", '[{"key":"x","peak":0,"at":0}]', '"not records"'])(
    "fails conservatively on corrupt optimization metadata: %s",
    (value) => {
      const { db } = fixture();
      db.settings.upsert(
        "worker_memory_profiles_v1",
        null,
        "fixture",
        new Date().toISOString(),
      );
      db.raw
        .prepare(
          "UPDATE system_settings SET value_json=? WHERE key='worker_memory_profiles_v1'",
        )
        .run(value);
      expect(planRenderMemory(db, candidate, image, 1152 * MIB).limit).toBe(
        1024 * MIB,
      );
    },
  );
  it("does not learn from mutable Runtime names or invalid output settings", () => {
    expect(memoryProfileKey(candidate, "runtime:latest")).toBeUndefined();
    expect(
      memoryProfileKey({ ...candidate, outputs_json: '["svg"]' }, image),
    ).toBeUndefined();
  });
});
