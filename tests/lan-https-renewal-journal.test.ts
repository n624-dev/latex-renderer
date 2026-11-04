import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LanHttpsClientState } from "../deploy/lan-https/client-state.mjs";
import { LanHttpsRenewalJournal } from "../deploy/lan-https/renewal-journal.mjs";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "lan-renewal-journal-"));
  roots.push(root);
  const state = new LanHttpsClientState(root);
  const context = "a".repeat(64);
  const options = { state, context, random: () => 0 };
  return {
    root,
    state,
    context,
    options,
    journal: new LanHttpsRenewalJournal(options),
  };
}
const now = 1_800_000_000_000;
describe("durable bounded renewal scheduling", () => {
  it("keeps one randomized ARI plan across restarts and starts only when due", () => {
    const f = fixture();
    expect(f.journal.due(now)).toBe(true);
    f.journal.plan({
      fingerprint256: "AB:".repeat(31) + "AB",
      renewAt: now + 5000,
      ari: true,
      certificateId: "AKI.SERIAL",
      now,
    });
    const restarted = new LanHttpsRenewalJournal(f.options);
    expect(restarted.due(now)).toBe(false);
    expect(restarted.due(now + 5000)).toBe(true);
    expect(restarted.read()?.renewAt).toBe(now + 5000);
    expect(() => restarted.begin(now)).toThrow(/not due/);
    restarted.begin(now + 5000);
    expect(new LanHttpsRenewalJournal(f.options).due(now + 6000)).toBe(false);
    expect(restarted.due(now + 605000)).toBe(true);
  });
  it("persists exponential backoff with jitter, caps local delay and honors longer server waits", () => {
    const f = fixture();
    f.journal.plan({ fingerprint256: null, renewAt: now, now });
    expect(f.journal.failed(now).nextAttemptAt).toBe(now + 60000);
    expect(
      new LanHttpsRenewalJournal(f.options).failed(now).nextAttemptAt,
    ).toBe(now + 120000);
    for (let i = 0; i < 30; i++) f.journal.failed(now);
    expect(f.journal.read()?.attempt).toBe(16);
    expect(f.journal.read()?.nextAttemptAt).toBe(now + 21600000);
    const next = now + 14 * 86400000;
    expect(f.journal.failed(now, next).nextAttemptAt).toBe(next);
    expect(f.journal.due(next - 1)).toBe(false);
    expect(f.journal.due(next)).toBe(true);
    const jittered = new LanHttpsRenewalJournal({
      ...f.options,
      random: () => 60000,
    });
    expect(jittered.failed(now).nextAttemptAt).toBe(now + 21660000);
  });
  it("resets retries after a validated published certificate and rejects unsafe metadata", () => {
    const f = fixture();
    f.journal.plan({ fingerprint256: null, renewAt: now, now });
    f.journal.failed(now);
    f.journal.plan({
      fingerprint256: "CD:".repeat(31) + "CD",
      renewAt: now + 10000,
      now,
    });
    expect(f.journal.read()?.attempt).toBe(0);
    expect(f.journal.read()?.nextAttemptAt).toBeNull();
    expect(() => f.journal.due(now - 300001)).toThrow(/clock moved backwards/);
    const original = readFileSync(join(f.root, "renewal.json"));
    const other = new LanHttpsRenewalJournal({
      ...f.options,
      context: "b".repeat(64),
    });
    expect(() => other.read()).toThrow(/state was retained/);
    expect(() =>
      other.plan({ fingerprint256: null, renewAt: now, now }),
    ).toThrow();
    expect(() => f.journal.failed(now, Number.NaN)).toThrow();
    expect(() => f.journal.failed(-1)).toThrow();
    expect(readFileSync(join(f.root, "renewal.json"))).toEqual(original);
    writeFileSync(join(f.root, "renewal.json"), "broken", { mode: 0o600 });
    expect(() => f.journal.read()).toThrow(/state was retained/);
  });
  it("preserves the previous schedule if atomic replacement runs out of space", () => {
    const f = fixture();
    f.journal.plan({ fingerprint256: null, renewAt: now, now });
    const original = readFileSync(join(f.root, "renewal.json"));
    const state = new LanHttpsClientState(f.root, {
      writeBytes: () => {
        throw new Error("ENOSPC");
      },
    });
    expect(() =>
      new LanHttpsRenewalJournal({ ...f.options, state }).begin(now),
    ).toThrow(/ENOSPC/);
    expect(readFileSync(join(f.root, "renewal.json"))).toEqual(original);
  });
});
