import { execFileSync } from "node:child_process";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { downloadPublishedRelease } from "./published-release.mjs";

// Administrator-only first installation, after install-host.sh and private
// host configuration. Existing hosts must use the application update operation.
if (process.getuid() !== 0 || process.argv.length !== 3)
  throw new Error("usage (root): bootstrap-published-host.mjs VERSION");
for (const path of [
  "/opt/latex-renderer/current",
  "/var/lib/latex-renderer/renderer.sqlite3",
]) {
  try {
    await lstat(path);
    throw new Error("Use the authenticated updater for an existing host");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const deployUser = process.env.SUDO_USER;
if (
  !deployUser ||
  deployUser === "root" ||
  !/^[a-z_][a-z0-9_-]{0,31}$/.test(deployUser)
)
  throw new Error("Use sudo from the non-root deployment user");
const stage = await mkdtemp("/opt/latex-renderer/update-staging/initial-");
try {
  const release = await downloadPublishedRelease(process.argv[2], stage);
  const helper = await import(
    pathToFileURL(
      join(release.source, "deploy/scripts/update-manager-helper.mjs"),
    )
  );
  const identity = {
    deployUser,
    uid: execFileSync("id", ["-u", deployUser], { encoding: "utf8" }).trim(),
    gid: execFileSync("id", ["-g", deployUser], { encoding: "utf8" }).trim(),
  };
  const manifest = await helper.verifyExtractedRelease(
    { ...release, tag: `v${release.version}` },
    release.source,
  );
  const assembly = await helper.buildBootstrapRelease(
    stage,
    release.source,
    manifest.packageManager,
    identity,
  );
  await helper.deploySealedAssembly(assembly, stage, release, manifest, true);
} finally {
  await rm(stage, { recursive: true, force: true });
}
