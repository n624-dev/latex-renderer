import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import {
  UpdaterSlots,
  updaterEnvelope,
  UPDATER_FILES,
} from "../deploy/scripts/updater-slots.mjs";
import {
  updaterStatus,
  expectedUpdater,
  updateOutcome,
} from "../deploy/scripts/updater-status.mjs";
import { runInNewContext } from "node:vm";
import { part7 } from "../apps/admin-web/src/assets/admin-script-parts/part-7.js";

const roots: string[] = [];
afterEach(async () => {
  for (const path of roots.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "updater-status-"));
  roots.push(root);
  const source = join(root, "source"),
    slots = new UpdaterSlots(join(root, "slots-root"));
  await mkdir(join(source, "deploy/scripts"), { recursive: true });
  for (const path of UPDATER_FILES)
    await writeFile(join(source, path), `fixture ${path}`);
  await writeFile(
    join(source, "deploy/updater-files.json"),
    JSON.stringify(UPDATER_FILES),
  );
  const envelope = await updaterEnvelope(source, {
    version: "9.0.0",
    commit: "a".repeat(40),
  });
  const id = await slots.stage(source, envelope);
  await slots.nominate(id);
  return {
    source,
    slots,
    envelope,
    id,
    runningRoot: join(slots.root, "slots", id),
  };
}
it("reports the verified running controller without changing the journal", async () => {
  const f = await fixture(),
    before = await readFile(join(f.slots.root, "state.json"));
  expect(await updaterStatus(f)).toMatchObject({
    status: "ready",
    running: expectedUpdater(f.envelope),
  });
  expect(await readFile(join(f.slots.root, "state.json"))).toEqual(before);
});
it("does not call a nominated or pending activation complete", async () => {
  const f = await fixture();
  const id = await f.slots.stage(f.source, { ...f.envelope, version: "9.1.0" });
  await f.slots.nominate(id);
  expect(await updaterStatus(f)).toMatchObject({
    status: "activating",
    running: { slotId: f.id },
    candidateSlotId: id,
  });
  await f.slots.begin();
  expect(
    await updaterStatus({ ...f, runningRoot: join(f.slots.root, "slots", id) }),
  ).toMatchObject({ status: "activating", pending: true });
  await f.slots.finish();
  expect(
    await updaterStatus({ ...f, runningRoot: join(f.slots.root, "slots", id) }),
  ).toMatchObject({ status: "ready" });
});
it("fails closed on corrupt state, tampering or an application-directory controller", async () => {
  const f = await fixture();
  expect((await updaterStatus({ ...f, runningRoot: f.source })).status).toBe(
    "unavailable",
  );
  await writeFile(join(f.runningRoot, "package.json"), "tampered");
  expect((await updaterStatus(f)).status).toBe("unavailable");
  await writeFile(join(f.slots.root, "state.json"), "broken");
  expect((await updaterStatus(f)).status).toBe("unavailable");
});
it("detects a journal switch during a read", async () => {
  const f = await fixture(),
    state = await f.slots.state();
  vi.spyOn(f.slots, "state")
    .mockResolvedValueOnce(state)
    .mockResolvedValueOnce({ ...state, candidate: "b".repeat(64) });
  expect((await updaterStatus(f)).status).toBe("activating");
});
it("only reports combined success for an exact committed slot identity", async () => {
  const f = await fixture(),
    status = await updaterStatus(f);
  const operation = {
    status: "succeeded",
    type: "apply",
    expectedUpdater: expectedUpdater(f.envelope),
    finishedAt: new Date().toISOString(),
  };
  expect(updateOutcome(operation, status).complete).toBe(true);
  expect(
    updateOutcome(
      {
        ...operation,
        expectedUpdater: {
          ...operation.expectedUpdater,
          slotId: "b".repeat(64),
        },
      },
      status,
    ).complete,
  ).toBe(false);
  expect(
    updateOutcome({ ...operation, status: "failed" }, status).complete,
  ).toBe(false);
  expect(
    updateOutcome({ ...operation, expectedUpdater: null }, status).updater,
  ).toBe("legacy-unconfirmed");
  const activating = { ...status, status: "activating", candidateSlotId: f.id };
  expect(updateOutcome(operation, activating).updater).toBe("activating");
  expect(
    updateOutcome(operation, activating, Date.now() + 11 * 60_000).updater,
  ).toBe("needs-attention");
});
it("renders application success separately until controller activation is confirmed", () => {
  const label = (operation: unknown): unknown =>
    runInNewContext(`${part7}\nupdateOperationLabel(operation)`, { operation });
  expect(label({ status: "succeeded" })).toBe("アプリ更新済み・Updater要確認");
  expect(
    label({ status: "succeeded", outcome: { updater: "activating" } }),
  ).toBe("アプリ更新済み・Updater切替待ち");
  expect(label({ status: "succeeded", outcome: { complete: true } })).toBe(
    "正常に完了",
  );
});
