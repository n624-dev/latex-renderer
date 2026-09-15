import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

// Keep the historical filename: installing a second policy leaves conflicting
// legacy ownership/age rules active on upgrades from old hosts.
const name = "latex-renderer-image-manager.conf";
export async function installManagerTmpfiles(
  directory = "/etc/tmpfiles.d",
  apply = (path) =>
    execFileSync("systemd-tmpfiles", ["--create", path], { timeout: 30_000 }),
) {
  directory = resolve(directory);
  const parent = await lstat(directory);
  if (
    !parent.isDirectory() ||
    parent.uid !== process.getuid() ||
    parent.mode & 0o022 ||
    (await realpath(directory)) !== directory
  )
    throw new Error("Manager tmpfiles policy requires a trusted directory");
  const target = join(directory, name);
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.uid !== parent.uid || info.nlink !== 1)
      throw new Error("Manager tmpfiles policy must be an owned regular file");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const data = await readFile(
    new URL(`../tmpfiles.d/${name}`, import.meta.url),
  );
  const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(data);
      await file.chmod(0o644);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, target);
    const dir = await open(directory, "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
    // No --clean during deployment. Never age-delete an active operation.
    // Failure propagates before the application current pointer is switched.
    await apply(target);
  } finally {
    await rm(temporary, { force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.getuid() !== 0 || process.argv.length !== 2)
    throw new Error(
      "Manager tmpfiles installation requires root without arguments",
    );
  await installManagerTmpfiles();
}
