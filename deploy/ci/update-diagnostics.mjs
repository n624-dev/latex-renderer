import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
if (
  process.getuid() !== 0 ||
  process.env.RUNNER_ENVIRONMENT !== "github-hosted"
)
  throw new Error("CI diagnostics only");
const marker = JSON.parse(
  readFileSync("/etc/latex-renderer-ci-host.json", "utf8"),
);
if (marker.runId !== process.env.GITHUB_RUN_ID) throw new Error("Wrong CI run");
let log = execFileSync(
  "/usr/bin/journalctl",
  [
    "--no-pager",
    "--output=cat",
    "-n",
    "200",
    "-u",
    "latex-renderer-updater-activate",
    "-u",
    "latex-renderer-updater-recovery",
    "-u",
    "latex-renderer-update-manager",
    "-u",
    "latex-renderer-update-manager.socket",
    "-u",
    "latex-renderer-image-manager",
    "-u",
    "latex-renderer-worker",
    "-u",
    "latex-renderer-api",
  ],
  { encoding: "utf8", maxBuffer: 1024 * 1024 },
).slice(-32 * 1024);
try {
  const database = new DatabaseSync(
    "/var/lib/latex-renderer/renderer.sqlite3",
    { readOnly: true },
  );
  try {
    database.exec("PRAGMA busy_timeout=1000");
    log +=
      "\n" +
      JSON.stringify({
        event: "ci.job_diagnostic",
        states: database
          .prepare("SELECT status,COUNT(*) AS count FROM jobs GROUP BY status")
          .all(),
      });
  } finally {
    database.close();
  }
  log +=
    "\n" +
    execFileSync("/usr/bin/ps", ["-eo", "pid,ppid,comm,stat,wchan:28"], {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 128 * 1024,
    }).slice(-16384);
} catch {
  log += '\n{"event":"ci.job_diagnostic_unavailable"}';
}
try {
  const root = "/var/lib/latex-renderer/image-manager";
  const statePath = `${root}/state.json`;
  const info = lstatSync(statePath);
  if (!info.isFile() || info.nlink !== 1 || info.size > 1024 * 1024)
    throw new Error("Invalid bounded manager diagnostic state");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  let operation = null;
  if (/^imgop_[0-9]{13}_[a-z0-9]{1,16}$/.test(state.lastOperationId ?? "")) {
    const path = `${root}/operations/${state.lastOperationId}.json`;
    const entry = lstatSync(path);
    if (!entry.isFile() || entry.nlink !== 1 || entry.size > 1024 * 1024)
      throw new Error("Invalid bounded manager diagnostic operation");
    const value = JSON.parse(readFileSync(path, "utf8"));
    operation = { type: value.type, status: value.status, error: value.error };
  }
  log +=
    "\n" +
    JSON.stringify({
      event: "ci.manager_diagnostic",
      lastApplyError: state.lastApplyError,
      lastCleanupAt: state.lastCleanupAt,
      operation,
    }).slice(-8192);
} catch {
  log += '\n{"event":"ci.manager_diagnostic_unavailable"}';
}
for (const name of readdirSync("/etc/latex-renderer/secrets")) {
  const path = `/etc/latex-renderer/secrets/${name}`,
    info = lstatSync(path);
  if (info.isFile() && info.size < 4096) {
    const secret = readFileSync(path, "utf8").trim();
    if (secret.length >= 16) log = log.replaceAll(secret, "[REDACTED]");
  }
}
console.log(log.replace(/Bearer\s+\S+|lrk_[A-Za-z0-9_-]+/g, "[REDACTED]"));
