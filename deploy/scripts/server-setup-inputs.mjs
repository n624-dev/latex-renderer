import { lstat, readdir, realpath, unlink } from "node:fs/promises";
import { resolve } from "node:path";

/** Only private, fixed-name review inputs left by this wizard. Two hours is
 * longer than the host operation's enforced 25-minute maximum; this is not a
 * live-workdir GC and never guesses from a PID or directory mtime.
 * root/uid/gid are trusted adapter configuration, never browser inputs.
 */
export async function cleanupServerSetupInputs(
  root,
  uid = 0,
  gid = 0,
  now = Date.now(),
) {
  if (
    typeof root !== "string" ||
    root === "/" ||
    !root.startsWith("/") ||
    resolve(root) !== root ||
    ![uid, gid, now].every((value) => Number.isSafeInteger(value) && value >= 0)
  )
    throw new Error("Invalid setup input store");
  const directory = await lstat(root);
  if (
    !directory.isDirectory() ||
    directory.uid !== uid ||
    directory.gid !== gid ||
    (directory.mode & 0o7777) !== 0o700 ||
    (await realpath(root)) !== root
  )
    throw new Error("Setup input store must be canonical and private");
  const entries = (await readdir(root)).filter((name) =>
    /^[a-f0-9]{48}\.json$/.test(name),
  );
  let removed = 0;
  for (const name of entries) {
    const path = `${root}/${name}`,
      info = await lstat(path);
    if (
      !info.isFile() ||
      info.uid !== uid ||
      info.gid !== gid ||
      info.nlink !== 1 ||
      (info.mode & 0o7777) !== 0o600 ||
      info.size > 128 * 1024
    )
      throw new Error("Unexpected setup input; refuse automatic deletion");
    if (now - info.mtimeMs < 2 * 60 * 60_000) continue;
    const current = await lstat(path);
    if (
      !current.isFile() ||
      current.dev !== info.dev ||
      current.ino !== info.ino ||
      current.nlink !== info.nlink ||
      current.mode !== info.mode ||
      current.uid !== info.uid ||
      current.gid !== info.gid ||
      current.mtimeMs !== info.mtimeMs
    )
      throw new Error("Setup input changed during cleanup");
    await unlink(path);
    removed++;
  }
  return { removed };
}
