import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmod,
  chown,
  copyFile,
  lstat,
  readFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  copyRootReleaseBundle,
  prepareReleaseExtraction,
} from "../scripts/release-extraction.mjs";
import { validateReleaseArchive } from "../scripts/release-archive.mjs";

// Disposable nested-archive probe, never a deployment or service policy change.
// Run as administrator after install-host has created the restricted account.
if (process.getuid() !== 0 || process.argv.length !== 2)
  throw new Error(
    "Run restricted-release-extraction.mjs as root, without arguments",
  );
const source = resolve(dirname(fileURLToPath(import.meta.url)), "../scripts");
const uid = Number(
  execFileSync("id", ["-u", "latex-renderer-update"], { encoding: "utf8" }),
);
const gid = Number(
  execFileSync("id", ["-g", "latex-renderer-update"], { encoding: "utf8" }),
);
const root = await mkdtemp(
  "/var/lib/latex-renderer/update-manager/extraction-probe-",
);
try {
  const input = join(root, "input"),
    output = join(root, "verified"),
    bundle = join(root, "fixture.tar.gz");
  await mkdir(join(input, "release/nested"), { recursive: true });
  await writeFile(
    join(input, "release/nested/fixture.txt"),
    "private fixture\n",
  );
  execFileSync("/usr/bin/tar", ["-czf", bundle, "-C", input, "release"]);
  await chmod(bundle, 0o600);
  await chown(bundle, uid, gid);
  // Exercise the actual helper's controller-owner -> root-owner boundary, not
  // only deploySealedAssembly (which receives already prepared source in E2E).
  const trusted = join(root, "trusted.tar.gz"),
    rootOutput = join(root, "root-verified");
  await copyRootReleaseBundle(bundle, trusted);
  const copied = await lstat(trusted);
  assert.equal(copied.uid, 0);
  assert.equal(copied.gid, 0);
  assert.equal(copied.mode & 0o7777, 0o600);
  assert.equal(copied.nlink, 1);
  assert.deepEqual(await readFile(trusted), await readFile(bundle));
  assert.equal((await lstat(bundle)).uid, uid);
  await mkdir(rootOutput, { mode: 0o700 });
  await validateReleaseArchive({
    bundle: trusted,
    topLevel: "release",
    maxEntries: 10,
    maxExpandedBytes: 100,
    maxExpandedFileBytes: 100,
  });
  const rootPlan = await prepareReleaseExtraction(trusted, rootOutput);
  execFileSync(rootPlan.command, rootPlan.args);
  assert.equal(
    await readFile(join(rootOutput, "release/nested/fixture.txt"), "utf8"),
    "private fixture\n",
  );
  await rm(rootOutput, { recursive: true });
  await rm(trusted);
  console.log(
    JSON.stringify({
      event: "root_release_bundle_copy.completed",
      sourceUid: uid,
      copiedUid: copied.uid,
      files: 1,
    }),
  );
  await mkdir(output, { mode: 0o700 });
  await chown(output, uid, gid);
  for (const name of ["release-extraction.mjs", "release-archive.mjs"]) {
    await copyFile(join(source, name), join(root, name));
    await chmod(join(root, name), 0o644);
  }
  const probe = join(root, "probe.mjs");
  await writeFile(
    probe,
    `import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { prepareReleaseExtraction } from './release-extraction.mjs';
import { validateReleaseArchive } from './release-archive.mjs';
const [bundle,directory]=process.argv.slice(2);
await validateReleaseArchive({bundle,topLevel:'release',maxEntries:10,maxExpandedBytes:100,maxExpandedFileBytes:100});
const plan=await prepareReleaseExtraction(bundle,directory);
execFileSync(plan.command,plan.args,{stdio:'inherit'});
if(await readFile(directory+'/release/nested/fixture.txt','utf8')!=='private fixture\\n')throw Error('Fixture mismatch');
console.log('restricted_release_extraction.completed');
`,
    { mode: 0o644 },
  );
  await chown(root, uid, gid);
  await chmod(root, 0o700);
  const result = execFileSync(
    "/usr/bin/systemd-run",
    [
      "--quiet",
      "--wait",
      "--pipe",
      "--collect",
      `--unit=latex-renderer-extraction-probe-${process.pid}`,
      "-p",
      "User=latex-renderer-update",
      "-p",
      "Group=latex-renderer",
      "-p",
      "RestrictSUIDSGID=true",
      "-p",
      "NoNewPrivileges=true",
      "-p",
      "PrivateNetwork=true",
      "-p",
      "ProtectSystem=strict",
      "-p",
      "ProtectHome=true",
      "-p",
      "PrivateDevices=true",
      "-p",
      "PrivateTmp=true",
      "-p",
      "SystemCallArchitectures=native",
      "-p",
      "UMask=0007",
      "-p",
      `ReadWritePaths=${root}`,
      "/usr/local/bin/node",
      probe,
      bundle,
      output,
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
  assert(result.includes("restricted_release_extraction.completed"));
  console.log(
    JSON.stringify({
      event: "restricted_release_extraction.completed",
      user: "latex-renderer-update",
      restrictSUIDSGID: true,
      noNewPrivileges: true,
      files: 1,
    }),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
