import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
    "latex-renderer-image-manager",
    "-u",
    "latex-renderer-worker",
    "-u",
    "latex-renderer-api",
  ],
  { encoding: "utf8", maxBuffer: 1024 * 1024 },
).slice(-32 * 1024);
for (const name of readdirSync("/etc/latex-renderer/secrets")) {
  const path = `/etc/latex-renderer/secrets/${name}`,
    info = lstatSync(path);
  if (info.isFile() && info.size < 4096) {
    const secret = readFileSync(path, "utf8").trim();
    if (secret.length >= 16) log = log.replaceAll(secret, "[REDACTED]");
  }
}
console.log(log.replace(/Bearer\s+\S+|lrk_[A-Za-z0-9_-]+/g, "[REDACTED]"));
