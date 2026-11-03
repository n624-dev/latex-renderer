import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import {
  workerHasDemand,
  workerIdleConfiguration,
  notifyWorker,
} from "./worker-demand.mjs";
import { isMainModule } from "./is-main-module.mjs";

export function workerMaintenanceDue(database, now = Date.now()) {
  const row = database
    .prepare(
      "SELECT value_json FROM system_settings WHERE key='worker_maintenance'",
    )
    .get();
  if (!row) return true;
  const value = JSON.parse(row.value_json);
  const completed = Date.parse(value.completedAt);
  if (!Number.isFinite(completed) || completed > now + 5000)
    throw new Error("Invalid Worker maintenance state");
  return now - completed >= 15 * 60_000;
}

export async function reconcileWorker({
  environment = process.env,
  run = (...args) =>
    execFileSync("/usr/bin/systemctl", args, {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  notify = notifyWorker,
} = {}) {
  if (!workerIdleConfiguration(environment).enabled)
    return { state: "disabled" };
  const database = new DatabaseSync(environment.DATABASE_PATH, {
    readOnly: true,
  });
  let demand, maintenance;
  try {
    database.exec("PRAGMA busy_timeout=5000");
    demand = workerHasDemand(database);
    maintenance = workerMaintenanceDue(database);
  } finally {
    database.close();
  }
  if (!demand && !maintenance) return { state: "idle" };
  // A listener deliberately stopped during deployment/maintenance must remain
  // stopped. This timer has no authority to start services or mutate the DB.
  const status = run(
    "show",
    "--no-pager",
    "--property=ActiveState,SubState",
    "latex-renderer-worker.socket",
  );
  if (
    !/^ActiveState=active$/m.test(status) ||
    !/^SubState=listening$/m.test(status)
  )
    return { state: "suspended", demand };
  if (!(await notify()))
    throw new Error(
      "Worker reconciliation could not deliver wake notification",
    );
  return { state: "notified", demand, maintenance };
}
if (isMainModule(import.meta.url))
  console.log(JSON.stringify(await reconcileWorker()));
