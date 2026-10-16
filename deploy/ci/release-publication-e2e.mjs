// Disposable GitHub-hosted host only. Never run fault injection on an installed
// server: the sealed run/boot marker is required before any mount or copy.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publishRelease } from "../scripts/release-publication.mjs";

if (
  process.getuid() !== 0 ||
  process.argv.length !== 2 ||
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.RUNNER_ENVIRONMENT !== "github-hosted"
)
  throw new Error(
    "Release publication fault injection requires a disposable CI host",
  );
const markerPath = "/etc/latex-renderer-ci-host.json",
  info = await lstat(markerPath);
assert(info.isFile() && info.uid === 0 && !(info.mode & 0o077));
const marker = JSON.parse(await readFile(markerPath, "utf8"));
assert.equal(marker.runId, process.env.GITHUB_RUN_ID);
assert.equal(
  marker.bootId,
  (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(),
);
const script = fileURLToPath(import.meta.url);
assert.equal(
  await import("node:fs/promises").then((fs) => fs.realpath(script)),
  script,
);
assert(
  resolve(dirname(script), "../..").startsWith(
    "/opt/latex-renderer/update-staging/ci-",
  ),
);

const work = await mkdtemp(
  "/opt/latex-renderer/update-staging/ci-release-copy-",
);
const source = join(work, "source"),
  releasesRoot = join(work, "releases"),
  journalRoot = join(work, "journals");
const releaseId = "v9.0.0-rc.1-aaaaaaaaaaaa";
const run = (args) =>
  execFileSync("/usr/bin/mount", args, { stdio: "pipe", timeout: 15000 });
let mounted = false;
try {
  await mkdir(source, { mode: 0o700 });
  await mkdir(releasesRoot, { mode: 0o700 });
  await writeFile(
    join(source, "fixture.bin"),
    Buffer.alloc(8 * 1024 ** 2, 0x61),
    { mode: 0o600 },
  );
  run([
    "-t",
    "tmpfs",
    "-o",
    "size=4m,mode=0700,nodev,nosuid,noexec",
    "tmpfs",
    releasesRoot,
  ]);
  mounted = true;
  const options = { source, releasesRoot, journalRoot, releaseId };
  let failure;
  try {
    await publishRelease(options);
  } catch (error) {
    failure = error;
  }
  assert.equal(
    failure?.code,
    "ENOSPC",
    "fixture must hit actual filesystem ENOSPC",
  );
  assert(!(await readdir(releasesRoot)).includes(releaseId));
  assert.equal(
    (await readdir(releasesRoot)).filter((n) => n.startsWith(".pending-"))
      .length,
    1,
  );
  // Resolve capacity, not source identity: retry exactly the same bytes and ID.
  run(["-o", "remount,size=16m", releasesRoot]);
  assert.deepEqual(await publishRelease(options), { releaseId, reused: false });
  assert.deepEqual(await publishRelease(options), { releaseId, reused: true });
  assert.equal(
    (await readFile(join(releasesRoot, releaseId, "fixture.bin"))).length,
    8 * 1024 ** 2,
  );
  assert(!(await readdir(releasesRoot)).some((n) => n.startsWith(".pending-")));
  console.log(
    JSON.stringify({
      event: "release.publication_e2e.passed",
      realEnospc: true,
      unpublishedOnFailure: true,
      sameReleaseRetry: true,
      immutableReuse: true,
    }),
  );
} finally {
  // If unmount fails, stop and leave the private fixture intact. Never recurse
  // through a mount, and never select a production directory for cleanup.
  if (mounted)
    execFileSync("/usr/bin/umount", [releasesRoot], {
      stdio: "pipe",
      timeout: 15000,
    });
  await rm(work, { recursive: true });
}
