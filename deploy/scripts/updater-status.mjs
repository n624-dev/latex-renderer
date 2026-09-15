import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UpdaterSlots } from "./updater-slots.mjs";

export function expectedUpdater(envelope) {
  if (
    envelope?.schemaVersion !== 1 ||
    !/^[a-f0-9]{40}$/.test(envelope.commit ?? "") ||
    !/^\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/.test(envelope.version ?? "")
  )
    throw new Error("Invalid expected Updater identity");
  return {
    version: envelope.version,
    commit: envelope.commit,
    slotId: createHash("sha256")
      .update(JSON.stringify(envelope) + "\n")
      .digest("hex"),
  };
}

// Read-only: never modifies the frozen activation journal or grants root access.
// Re-read the journal after verification so a concurrent switch isn't reported
// as a committed, healthy running controller.
export async function updaterStatus({
  slots = new UpdaterSlots("/opt/latex-renderer/updater", 0),
  runningRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
} = {}) {
  try {
    const before = await slots.state();
    const current = await slots.verify(before.current);
    const runningId = runningRoot.startsWith(`${slots.root}/slots/`)
      ? runningRoot.slice(`${slots.root}/slots/`.length)
      : null;
    if (!/^[a-f0-9]{64}$/.test(runningId ?? ""))
      throw new Error("Controller is not running from an independent slot");
    const running =
      runningId === before.current ? current : await slots.verify(runningId);
    const after = await slots.state();
    const transitioning =
      JSON.stringify(before) !== JSON.stringify(after) ||
      Boolean(after.pending || after.candidate) ||
      runningId !== after.current;
    return {
      status: transitioning ? "activating" : "ready",
      running: { ...expectedUpdater(running.envelope), slotId: runningId },
      selectedSlotId: after.current,
      candidateSlotId: after.candidate,
      pending: Boolean(after.pending),
    };
  } catch {
    // Do not expose filesystem details or turn unreadable state into success.
    return {
      status: "unavailable",
      running: null,
      selectedSlotId: null,
      candidateSlotId: null,
      pending: false,
    };
  }
}

export function updateOutcome(operation, updater, now = Date.now()) {
  if (operation.status !== "succeeded")
    return {
      application: operation.status,
      updater: "not-confirmed",
      complete: false,
    };
  if (!["apply", "automatic-apply", "rollback"].includes(operation.type))
    return {
      application: "succeeded",
      updater: "not-required",
      complete: true,
    };
  const expected = operation.expectedUpdater;
  if (!expected)
    return {
      application: "succeeded",
      updater: "legacy-unconfirmed",
      complete: false,
    };
  const matches =
    updater.status === "ready" &&
    updater.running?.slotId === expected.slotId &&
    updater.running?.version === expected.version &&
    updater.running?.commit === expected.commit;
  if (matches)
    return { application: "succeeded", updater: "succeeded", complete: true };
  const finished = Date.parse(operation.finishedAt ?? "");
  const recent =
    Number.isFinite(finished) &&
    now >= finished &&
    now - finished < 10 * 60_000;
  const pending =
    recent &&
    updater.status === "activating" &&
    (updater.candidateSlotId === expected.slotId ||
      updater.selectedSlotId === expected.slotId);
  return {
    application: "succeeded",
    updater: pending ? "activating" : "needs-attention",
    complete: false,
  };
}

export async function readExpectedUpdater(source) {
  return expectedUpdater(
    JSON.parse(
      await readFile(join(source, ".latex-renderer-updater.json"), "utf8"),
    ),
  );
}
