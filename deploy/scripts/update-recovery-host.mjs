import { execFileSync } from "node:child_process";
import { lstat, readFile, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireMutationLock } from "./mutation-lock.mjs";
import { RecoveryStore, recoveryPolicy } from "./update-recovery.mjs";

const root = "/var/lib/latex-renderer-update-recovery";
const timers = [
  "backup",
  "cleanup",
  "audit-export",
  "update-refresh",
  "image-refresh",
  "image-operation-watchdog",
  "image-log-cleanup",
].map((name) => `latex-renderer-${name}.timer`);
const writers = [
  "standalone-gateway",
  "api",
  "internal-api",
  "admin-api",
  "admin-web",
  "remote-mcp",
  "worker",
].map((name) => `latex-renderer-${name}.service`);
const maintenance = ["backup", "cleanup", "audit-export"].map(
  (name) => `latex-renderer-${name}.service`,
);
const units = [...timers, ...writers];
function validateJournal(value) {
  if (
    value?.format !== 1 ||
    !Array.isArray(value.units) ||
    value.units.length > units.length ||
    new Set(value.units).size !== value.units.length ||
    value.units.some((unit) => !units.includes(unit)) ||
    !Number.isSafeInteger(value.owner?.pid) ||
    value.owner.pid < 1 ||
    !/^[0-9]{1,32}$/.test(value.owner.start ?? "") ||
    typeof value.owner.boot !== "string" ||
    !/^[A-Za-z0-9-]{1,128}$/.test(value.owner.boot) ||
    !(
      value.pointId === null ||
      (typeof value.pointId === "string" &&
        /^rp-[0-9]{13}-[a-f0-9]{12}$/.test(value.pointId))
    )
  )
    throw new Error("Corrupt recovery operation journal");
  return value;
}

const systemctl = (...args) =>
  execFileSync("/usr/bin/systemctl", args, {
    encoding: "utf8",
    timeout: 15 * 60_000,
  });
const active = (unit) => {
  const state = systemctl(
    "show",
    "--property=ActiveState",
    "--value",
    unit,
  ).trim();
  if (
    !["active", "inactive", "failed", "activating", "deactivating"].includes(
      state,
    )
  )
    throw new Error("Cannot determine recovery unit state");
  return ["active", "activating", "deactivating"].includes(state);
};
async function privateJson(path) {
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.uid !== 0 ||
    info.mode & 0o077 ||
    info.size > 64 * 1024 ||
    (await realpath(path)) !== path
  )
    throw new Error(
      "Recovery configuration/journal is not private root-owned data",
    );
  return JSON.parse(await readFile(path, "utf8"));
}
async function storeForHost() {
  let settings = {};
  try {
    settings = await privateJson("/etc/latex-renderer/update-recovery.json");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return new RecoveryStore(root, recoveryPolicy(settings));
}
async function ownerIdentity(pid = process.pid) {
  const stat = await readFile(`/proc/${pid}/stat`, "utf8");
  return {
    pid,
    boot: (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(),
    start: stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19],
  };
}
async function restoreUnits(original, run = systemctl) {
  const errors = [];
  // Start applications before timers, and attempt every restoration even when
  // an individual unit fails. Never turn on a previously inactive unit here.
  for (const unit of [...original].sort(
    (a, b) => Number(a.endsWith(".timer")) - Number(b.endsWith(".timer")),
  )) {
    try {
      run("start", unit);
    } catch {
      errors.push(unit);
    }
  }
  if (errors.length)
    throw new Error(
      `RECOVERY_REVIEW_REQUIRED: Recovery could not restore units: ${errors.join(", ")}`,
    );
}

// Injection is for isolated tests; the privileged CLI exposes no paths, unit
// names, executable arguments, or untrusted helper verbs.
export async function withQuiescedRecovery(
  { store, create, inspect = active, run = systemctl, owner = ownerIdentity },
  action,
) {
  await store.initialize();
  const journalPath = join(store.root, "operation.json");
  try {
    const entry = await lstat(journalPath);
    if (
      !entry.isFile() ||
      entry.uid !== process.getuid() ||
      entry.mode & 0o077 ||
      entry.size > 64 * 1024
    )
      throw new Error("Unsafe recovery operation journal");
    const previous = validateJournal(
      JSON.parse(await readFile(journalPath, "utf8")),
    );
    let running;
    try {
      running = await owner(previous.owner.pid);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error;
    }
    if (running && JSON.stringify(running) === JSON.stringify(previous.owner))
      throw new Error("RECOVERY_BUSY: previous owner is still running");
    await restoreUnits(previous.units, run);
    if (previous.pointId)
      throw new Error(
        "RECOVERY_REVIEW_REQUIRED: inspect the interrupted deployment before acknowledging its recovery point",
      );
    await rm(journalPath);
    await store.sync();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const original = units.filter(inspect);
  const journal = {
    format: 1,
    owner: await owner(),
    units: original,
    pointId: null,
  };
  await store.atomic("operation.json", journal);
  let point,
    completed = false;
  try {
    for (const unit of timers) if (original.includes(unit)) run("stop", unit);
    if (maintenance.some(inspect))
      throw new Error(
        "Recovery waits for active backup/cleanup/export to finish",
      );
    for (const unit of writers) if (original.includes(unit)) run("stop", unit);
    if (writers.some(inspect))
      throw new Error("Recovery writers did not quiesce");
    point = await create();
    await store.atomic("operation.json", { ...journal, pointId: point.id });
    const result = await action(point);
    completed = true;
    return result;
  } catch (error) {
    if (point)
      throw new Error(
        `RECOVERY_REVIEW_REQUIRED: recovery point ${point.id} is protected; deployment failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    throw error;
  } finally {
    await restoreUnits(original, run);
    if (completed || !point) {
      await rm(journalPath);
      await store.sync();
      if (completed && point) {
        try {
          await store.collect({ protectedId: point.id });
        } catch {
          console.error(
            "Recovery GC failed after successful deployment; inspect the recovery store before the next update",
          );
        }
      }
    }
  }
}

export async function withHostRecovery(action) {
  if (process.getuid() !== 0) throw new Error("Recovery requires root");
  const current = "/opt/latex-renderer/current";
  let source;
  try {
    source = await realpath(current);
  } catch (error) {
    if (error.code === "ENOENT") return action(null);
    throw error;
  }
  if (!/^\/opt\/latex-renderer\/releases\/[A-Za-z0-9._-]+$/.test(source))
    throw new Error("Unsafe recovery release identity");
  const release = JSON.parse(
    await readFile(join(source, ".latex-renderer-release.json"), "utf8"),
  );
  if (
    !/^\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/.test(release.version ?? "") ||
    !/^[a-f0-9]{40}$/.test(release.commit ?? "")
  )
    throw new Error("Invalid recovery release identity");
  const store = await storeForHost();
  const recipient = "/etc/latex-renderer/secrets/backup-age-recipient",
    identity = "/etc/latex-renderer/secrets/backup-age-identity";
  for (const path of [recipient, identity]) {
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.uid !== 0 ||
      info.mode & (path === identity ? 0o077 : 0o022) ||
      (await realpath(path)) !== path
    )
      throw new Error("Recovery encryption keys must be trusted host files");
  }
  return withQuiescedRecovery(
    {
      store,
      create: () =>
        store.create({
          database: "/var/lib/latex-renderer/renderer.sqlite3",
          storage: "/var/lib/latex-renderer/storage",
          recipient,
          identity,
          release: { version: release.version, commit: release.commit },
        }),
    },
    async (point) => {
      console.log(
        JSON.stringify({
          event: "update.recovery_verified",
          id: point.id,
          bytes: point.archive.bytes,
        }),
      );
      return action(point);
    },
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const verb = process.argv[2];
  if (
    process.getuid() !== 0 ||
    !(
      (process.argv.length === 3 &&
        ["create", "gc", "status"].includes(verb)) ||
      (process.argv.length === 4 &&
        verb === "acknowledge" &&
        /^rp-[0-9]{13}-[a-f0-9]{12}$/.test(process.argv[3]))
    )
  )
    throw new Error(
      "usage (root): update-recovery-host.mjs create|gc|status|acknowledge POINT_ID",
    );
  let lock;
  try {
    lock = await acquireMutationLock();
  } catch (error) {
    if (verb === "gc" && error.code === "MUTATION_LOCK_BUSY") {
      console.log("Recovery GC deferred: update in progress");
      process.exit(0);
    }
    throw error;
  }
  try {
    if (verb === "create") await withHostRecovery(() => {});
    else {
      const store = await storeForHost();
      await store.initialize();
      // A live or interrupted deployment journal protects its recovery point.
      // GC never resumes services or guesses that a journal is stale.
      let pending = null;
      try {
        pending = validateJournal(
          await privateJson(join(root, "operation.json")),
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (verb === "acknowledge") {
        if (
          pending?.format !== 1 ||
          pending.pointId !== process.argv[3] ||
          !Array.isArray(pending.units) ||
          pending.units.some((unit) => !units.includes(unit))
        )
          throw new Error(
            "Recovery acknowledgement must name the pending point exactly",
          );
        let alive;
        try {
          alive = await ownerIdentity(pending.owner.pid);
        } catch (error) {
          if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error;
        }
        if (alive && JSON.stringify(alive) === JSON.stringify(pending.owner))
          throw new Error("Recovery owner is still running");
        await restoreUnits(pending.units);
        await rm(join(root, "operation.json"));
        await store.sync();
        pending = null;
      }
      if (verb === "gc" && !pending) await store.collect();
      const points = await store.points();
      console.log(
        JSON.stringify({
          pending: Boolean(pending),
          points: verb === "status" ? points : points.length,
          bytes: await store.usage(),
        }),
      );
    }
  } finally {
    await lock.release();
  }
}
