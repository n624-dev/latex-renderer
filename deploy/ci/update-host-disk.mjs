import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, realpathSync, statfsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const UPDATE_HOST_MINIMUM_BYTES = 32 * 1024 ** 3;
export const UPDATE_HOST_TARGET_BYTES = 48 * 1024 ** 3;
// These optional SDKs are unused by Node, Docker and the update fixtures.
// Never remove the tool cache, application data, Node, or container images.
const optionalSdks = [
  "/usr/local/lib/android",
  "/usr/share/dotnet",
  "/opt/ghc",
  "/usr/local/.ghcup",
  "/usr/share/swift",
  "/usr/local/share/boost",
];

export function inspectSdkDirectory(path) {
  let info;
  try {
    info = lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    throw error;
  }
  if (!info.isDirectory() || realpathSync(path) !== resolve(path))
    return "unsafe";
  const mount = spawnSync(
    "/usr/bin/findmnt",
    ["--noheadings", "--mountpoint", path],
    {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 16 * 1024,
    },
  );
  if (mount.error) throw mount.error;
  if (mount.status === 0) return "mounted";
  if (mount.status !== 1) throw new Error("Cannot inspect SDK mount boundary");
  return "directory";
}

export function prepareUpdateHostDisk(options = {}) {
  const {
    uid = process.getuid?.(),
    environment = process.env,
    scriptPath = fileURLToPath(import.meta.url),
    exists = existsSync,
    inspect = inspectSdkDirectory,
    available = () => {
      const disk = statfsSync("/var/lib");
      return disk.bavail * disk.bsize;
    },
    remove = (path) =>
      execFileSync(
        "/usr/bin/rm",
        ["--one-file-system", "--recursive", "--force", "--", path],
        { stdio: "inherit", timeout: 300_000 },
      ),
    log = (record) => console.log(JSON.stringify(record)),
  } = options;
  if (
    uid !== 0 ||
    environment.GITHUB_ACTIONS !== "true" ||
    environment.RUNNER_ENVIRONMENT !== "github-hosted" ||
    !/^\d+$/.test(environment.GITHUB_RUN_ID ?? "") ||
    !resolve(scriptPath).startsWith("/home/runner/work/")
  )
    throw new Error(
      "Disk preparation requires a disposable GitHub-hosted update runner",
    );
  for (const path of [
    "/etc/latex-renderer",
    "/opt/latex-renderer",
    "/var/lib/latex-renderer",
    "/etc/latex-renderer-ci-host.json",
  ])
    if (exists(path))
      throw new Error("Refusing disk preparation on an application host");
  const sample = () => {
    const bytes = available();
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new Error("Cannot measure update-host disk capacity");
    return bytes;
  };
  const beforeBytes = sample(),
    removedSdkDirectories = [];
  let availableBytes = beforeBytes;
  for (const path of optionalSdks) {
    if (availableBytes >= UPDATE_HOST_TARGET_BYTES) break;
    if (inspect(path) !== "directory") continue;
    remove(path);
    removedSdkDirectories.push(path);
    // Shared blocks, delayed release and mounts make apparent sizes unreliable.
    availableBytes = sample();
  }
  const report = {
    event: "ci.update_host_disk",
    beforeBytes,
    availableBytes,
    minimumBytes: UPDATE_HOST_MINIMUM_BYTES,
    targetBytes: UPDATE_HOST_TARGET_BYTES,
    removedSdkDirectories,
  };
  log(report);
  if (availableBytes < UPDATE_HOST_MINIMUM_BYTES)
    throw new Error(
      "RUNNER_CAPACITY_BLOCKED: insufficient disk before update-host provisioning",
    );
  return report;
}
