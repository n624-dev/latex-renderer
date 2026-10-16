import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  chown,
  cp,
  lchown,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireMutationLockForPath } from "./mutation-lock.mjs";
import { isMainModule } from "./is-main-module.mjs";

const marker = ".host-prepare-source-complete";
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const deploymentDriver = "deploy/scripts/deploy-production-release.sh";
const derived = (relative) =>
  /^(?:node_modules|client-dist)(?:\/|$)/.test(relative) ||
  /^(?:apps|packages)\/[^/]+\/(?:dist|node_modules)(?:\/|$)/.test(relative);
const excluded = (relative) =>
  relative.split("/").includes(".git") ||
  relative === ".deployment-tooling" ||
  relative.startsWith(".deployment-tooling/") ||
  relative === marker;

async function exists(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function syncDirectory(path) {
  const fd = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await fd.sync();
  } finally {
    await fd.close();
  }
}
async function directory(path, uid) {
  const s = await lstat(path);
  if (
    !s.isDirectory() ||
    s.isSymbolicLink() ||
    s.uid !== uid ||
    s.mode & 0o022 ||
    (await realpath(path)) !== path
  )
    throw new Error("Unsafe release publication directory");
  return s;
}
async function noMounts(root) {
  const mounts = await readFile("/proc/self/mountinfo", "utf8");
  for (const line of mounts.trim().split("\n")) {
    const path = line
      .split(" ")[4]
      ?.replace(/\\([0-7]{3})/g, (_, octal) =>
        String.fromCharCode(parseInt(octal, 8)),
      );
    if (path === root || path?.startsWith(root + sep))
      throw new Error("Mounted release publication path");
  }
}

// Names, file bytes, symlink destinations and executable bits identify the
// payload. Ownership and write permissions are normalized separately, before
// publication. Never follow a payload link while reading or deleting it.
async function tree(
  root,
  {
    normalize,
    uid,
    gid,
    sync = false,
    verifyOwnership = false,
    includeExcluded = false,
    sourceExclusions = false,
    controlOnly = false,
    canonicalDriver = null,
  } = {},
) {
  const base = await lstat(root),
    digest = createHash("sha256");
  if (
    !base.isDirectory() ||
    base.isSymbolicLink() ||
    (await realpath(root)) !== root
  )
    throw new Error("Unsafe release source root");
  await noMounts(root);
  let entries = 0;
  async function walk(path, relative) {
    if (++entries > 200_000 || relative.split("/").length > 128)
      throw new Error("Release publication tree limit exceeded");
    const s = await lstat(path);
    if (s.dev !== base.dev) throw new Error("Cross-device release payload");
    if (
      verifyOwnership &&
      (s.uid !== uid ||
        s.gid !== gid ||
        (!s.isSymbolicLink() && s.mode & 0o022))
    )
      throw new Error("Unsafe immutable release ownership or permissions");
    if (s.isDirectory()) {
      digest.update(JSON.stringify([relative, "directory"]) + "\n");
      for (const name of (await readdir(path)).sort()) {
        const rel = relative ? `${relative}/${name}` : name;
        if (
          (!controlOnly || !derived(rel)) &&
          (includeExcluded ||
            (rel !== marker && (!sourceExclusions || !excluded(rel))))
        )
          await walk(join(path, name), rel);
      }
      if (normalize) {
        await chown(path, uid, gid);
        await chmod(path, 0o750);
      }
      if (sync) await syncDirectory(path);
    } else if (s.isFile()) {
      if (normalize && s.nlink !== 1)
        throw new Error("Shared release copy inode");
      const handle = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const before = await handle.stat(),
          hash = createHash("sha256");
        if (!before.isFile() || before.dev !== s.dev || before.ino !== s.ino)
          throw new Error("Release file replaced during inspection");
        for await (const bytes of handle.createReadStream({ autoClose: false }))
          hash.update(bytes);
        const after = await handle.stat();
        if (
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          before.ctimeMs !== after.ctimeMs
        )
          throw new Error("Release file changed during inspection");
        // Rollback executes a driver copied from the verified running Updater.
        // Bind source identity to the requested release's original descriptor;
        // the complete installed-tree hash still verifies the actual file.
        const canonical =
          controlOnly && relative === deploymentDriver ? canonicalDriver : null;
        digest.update(
          JSON.stringify([
            relative,
            "file",
            Boolean(s.mode & 0o111),
            canonical?.bytes ?? before.size,
            canonical?.sha256 ?? hash.digest("hex"),
          ]) + "\n",
        );
        if (normalize) {
          await handle.chown(uid, gid);
          await handle.chmod(s.mode & 0o111 ? 0o750 : 0o640);
        }
        if (sync) await handle.sync();
      } finally {
        await handle.close();
      }
    } else if (s.isSymbolicLink()) {
      const target = await readlink(path),
        destination = await realpath(path);
      if (destination !== root && !destination.startsWith(root + sep))
        throw new Error("External release symlink");
      digest.update(JSON.stringify([relative, "link", target]) + "\n");
      if (normalize) await lchown(path, uid, gid);
    } else throw new Error("Special release payload entry");
  }
  await walk(root, "");
  return digest.digest("hex");
}

async function privateJson(path, uid) {
  const s = await lstat(path);
  if (
    !s.isFile() ||
    s.uid !== uid ||
    s.nlink !== 1 ||
    s.mode & 0o077 ||
    s.size > 4096 ||
    (await realpath(path)) !== path
  )
    throw new Error("Unsafe release publication journal");
  return JSON.parse(await readFile(path, "utf8"));
}
async function runCopy(source, destination) {
  // Keep filesystem writes in this process. A killed publisher must not leave
  // an rsync child copying into a stage that the next attempt is reclaiming.
  for (const name of (await readdir(source)).sort()) {
    if (excluded(name)) continue;
    await cp(join(source, name), join(destination, name), {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      force: false,
      errorOnExist: true,
      filter: (path) => !excluded(path.slice(source.length + 1)),
    });
  }
}

async function sourceIdentity(source, releaseId, fullHash) {
  const metadataPath = join(source, ".latex-renderer-release.json");
  if (!(await exists(metadataPath))) return { sourceHash: fullHash };
  for (const file of [
    metadataPath,
    join(source, ".latex-renderer-updater.json"),
  ]) {
    const info = await lstat(file);
    if (!info.isFile() || info.size > 128 * 1024)
      throw new Error("Invalid verified release metadata");
  }
  const manifest = JSON.parse(await readFile(metadataPath, "utf8"));
  const envelope = JSON.parse(
    await readFile(join(source, ".latex-renderer-updater.json"), "utf8"),
  );
  const driver = envelope?.files?.[deploymentDriver];
  if (
    manifest.schemaVersion !== 1 ||
    manifest.repository !== "n624-dev/latex-renderer" ||
    !/^\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/.test(manifest.version ?? "") ||
    !/^[a-f0-9]{40}$/.test(manifest.commit ?? "") ||
    releaseId !== `v${manifest.version}-${manifest.commit.slice(0, 12)}` ||
    envelope.schemaVersion !== 1 ||
    envelope.version !== manifest.version ||
    envelope.commit !== manifest.commit ||
    !hashPattern.test(driver?.sha256 ?? "") ||
    !Number.isSafeInteger(driver?.bytes) ||
    driver.bytes < 1
  )
    throw new Error(
      "Verified release identity differs from the publication identifier",
    );
  // This is not a signature verifier. Only the already verified, sealed
  // assembly reaches the root CLI. Include metadata and all non-derived files,
  // not just a claimed version/commit. Rebuilt ZIP/CMS bytes need not match.
  return {
    sourceHash: await tree(source, {
      sourceExclusions: true,
      controlOnly: true,
      canonicalDriver: driver,
    }),
  };
}

// The caller holds the host mutation lock (or initial-install serialization).
// A second, publication-only lock also serializes standalone prepare-host calls.
// Test adapters change filesystem roots, never the privileged CLI contract.
export async function publishRelease({
  source,
  releaseId,
  releasesRoot,
  journalRoot,
  uid = process.getuid(),
  gid = process.getgid(),
  copy = runCopy,
  checkpoint = async () => {},
}) {
  if (
    typeof releaseId !== "string" ||
    !idPattern.test(releaseId) ||
    releaseId.includes("..")
  )
    throw new Error("Invalid release publication identifier");
  for (const path of [source, releasesRoot, journalRoot])
    if (resolve(path) !== path)
      throw new Error("Release publication paths must be absolute");
  await directory(releasesRoot, uid);
  await directory(dirname(journalRoot), uid);
  await mkdir(journalRoot, { mode: 0o700 }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  await directory(journalRoot, uid);
  await syncDirectory(dirname(journalRoot));
  const lockPath = join(journalRoot, "publication.lock");
  try {
    const file = await open(lockPath, "wx", 0o600);
    await file.close();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const lockInfo = await lstat(lockPath);
  if (
    !lockInfo.isFile() ||
    lockInfo.uid !== uid ||
    lockInfo.nlink !== 1 ||
    lockInfo.mode & 0o077 ||
    (await realpath(lockPath)) !== lockPath
  )
    throw new Error("Unsafe release publication lock");
  const lock = await acquireMutationLockForPath(lockPath);
  try {
    const target = join(releasesRoot, releaseId);
    const journalPath = join(journalRoot, `${releaseId}.json`);
    const next = `${journalPath}.next`;
    const expectedHash = await tree(source, { sourceExclusions: true });
    const { sourceHash } = await sourceIdentity(
      source,
      releaseId,
      expectedHash,
    );
    let journal;
    if (await exists(journalPath)) {
      journal = await privateJson(journalPath, uid);
      if (
        journal?.format !== 1 ||
        journal.releaseId !== releaseId ||
        journal.sourceHash !== sourceHash ||
        !hashPattern.test(journal.treeHash) ||
        typeof journal.stage !== "string" ||
        !new RegExp(
          `^\\.pending-${releaseId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-[a-f0-9-]{36}$`,
        ).test(journal.stage)
      )
        throw new Error(
          "Release publication journal does not match the verified source",
        );
    }
    const discardStage = async () => {
      const stage = join(releasesRoot, journal.stage);
      if (await exists(stage)) {
        await directory(stage, uid);
        await tree(stage, { includeExcluded: true }); // Validate even excluded leftovers before deletion.
        await rm(stage, { recursive: true });
        await syncDirectory(releasesRoot);
      }
    };
    const current = await exists(target);
    if (current) {
      await directory(target, uid);
      const complete = await exists(join(target, marker));
      if (
        !complete?.isFile() ||
        complete.uid !== uid ||
        complete.nlink !== 1 ||
        complete.size > 4096 ||
        complete.mode & 0o022
      )
        throw new Error(
          "Existing release is incomplete or unrecognized; refusing overwrite",
        );
      // Legacy empty markers are accepted only with a complete byte comparison.
      let installedHash = expectedHash;
      if (complete.size) {
        const m = JSON.parse(await readFile(join(target, marker), "utf8"));
        if (
          m.format !== 1 ||
          m.releaseId !== releaseId ||
          m.sourceHash !== sourceHash ||
          !hashPattern.test(m.treeHash ?? "")
        )
          throw new Error("Existing immutable release identity differs");
        installedHash = m.treeHash;
      }
      if (
        (await tree(target, { verifyOwnership: true, uid, gid })) !==
        installedHash
      )
        throw new Error("Existing immutable release contents differ");
      if (journal) {
        await discardStage();
        await unlink(journalPath);
        await syncDirectory(journalRoot);
      }
      return { releaseId, reused: true };
    }
    if (journal) await discardStage();
    {
      // A crash while writing .next cannot have created a stage: the journal
      // rename and directory fsync always precede mkdir/copy.
      if (await exists(next)) {
        await privateJson(next, uid).catch(async () => {
          const s = await lstat(next);
          if (!s.isFile() || s.uid !== uid || s.nlink !== 1 || s.mode & 0o077)
            throw new Error("Unsafe interrupted release journal");
        });
        await unlink(next);
      }
      journal ??= {
        format: 1,
        releaseId,
        treeHash: expectedHash,
        sourceHash,
        stage: `.pending-${releaseId}-${randomUUID()}`,
      };
      journal.treeHash = expectedHash;
      const fd = await open(next, "wx", 0o600);
      try {
        await fd.writeFile(JSON.stringify(journal) + "\n");
        await fd.sync();
      } finally {
        await fd.close();
      }
      await rename(next, journalPath);
      await syncDirectory(journalRoot);
    }
    const stage = join(releasesRoot, journal.stage);
    await mkdir(stage, { mode: 0o700 });
    await syncDirectory(releasesRoot);
    await checkpoint("journal-durable");
    // Failure deliberately leaves the identified private stage and journal.
    // A later attempt removes only this exact owned stage, never a final tree.
    await copy(source, stage);
    if (
      (await tree(stage, { normalize: true, uid, gid, sync: true })) !==
      expectedHash
    )
      throw new Error("Copied release differs from the verified source");
    const receipt = await open(join(stage, marker), "wx", 0o640);
    try {
      await receipt.chown(uid, gid);
      await receipt.writeFile(
        JSON.stringify({
          format: 1,
          releaseId,
          treeHash: expectedHash,
          sourceHash,
        }) + "\n",
      );
      await receipt.sync();
    } finally {
      await receipt.close();
    }
    await syncDirectory(stage);
    await checkpoint("copy-durable");
    if (await exists(target))
      throw new Error("Release target appeared during publication");
    await rename(stage, target);
    await syncDirectory(releasesRoot);
    await checkpoint("published");
    await unlink(journalPath);
    await syncDirectory(journalRoot);
    return { releaseId, reused: false };
  } finally {
    await lock.release();
  }
}

if (isMainModule(import.meta.url)) {
  if (process.getuid() !== 0 || process.argv.length !== 3)
    throw new Error("usage (root): release-publication.mjs RELEASE_ID");
  const source = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const group = await readFile("/etc/group", "utf8");
  const gid = Number(/^latex-renderer:[^:]*:([0-9]+):/m.exec(group)?.[1]);
  if (!Number.isSafeInteger(gid)) throw new Error("Missing application group");
  console.log(
    JSON.stringify(
      await publishRelease({
        source,
        releaseId: process.argv[2],
        releasesRoot: "/opt/latex-renderer/releases",
        journalRoot: "/opt/latex-renderer/update-staging/release-publications",
        uid: 0,
        gid,
      }),
    ),
  );
}
