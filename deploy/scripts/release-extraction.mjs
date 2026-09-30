import { constants } from "node:fs";
import { access, lstat, realpath, readdir } from "node:fs/promises";
import { resolve } from "node:path";

// GNU tar's Ubuntu openat2 backport conflicts with RestrictSUIDSGID. Keep the
// service restriction and use the distro's libarchive extractor instead. No
// PATH override, configurable executable, or fallback to unrestricted tar.
export const releaseExtractor = "/usr/bin/bsdtar";

export async function assertReleaseExtractor() {
  let info;
  try {
    info = await lstat(releaseExtractor);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    throw new Error(
      "Install libarchive-tools before updating: /usr/bin/bsdtar is required",
      { cause: error },
    );
  }
  if (!info.isFile() || info.uid !== 0 || info.mode & 0o022)
    throw new Error("Release extractor must be a sealed root-owned executable");
  await access(releaseExtractor, constants.X_OK);
}

// Call only after the immutable digest, attestation AND GNU tar archive limits
// have been verified. Both controller and helper use fresh private directories.
export async function prepareReleaseExtraction(bundle, directory) {
  await assertReleaseExtractor();
  for (const path of [bundle, directory]) {
    if (
      typeof path !== "string" ||
      resolve(path) !== path ||
      (await realpath(path)) !== path
    )
      throw new Error(
        "Release extraction paths must be canonical absolute paths",
      );
  }
  const file = await lstat(bundle),
    destination = await lstat(directory);
  if (
    !file.isFile() ||
    file.nlink !== 1 ||
    file.uid !== process.getuid() ||
    file.mode & 0o022
  )
    throw new Error("Release extraction requires a private regular bundle");
  if (
    !destination.isDirectory() ||
    destination.uid !== process.getuid() ||
    destination.mode & 0o077
  )
    throw new Error("Release extraction requires a private destination");
  if ((await readdir(directory)).length)
    throw new Error("Release extraction destination must be empty");
  return {
    command: releaseExtractor,
    args: [
      "-xf",
      bundle,
      "--directory",
      directory,
      "--no-same-owner",
      "--no-same-permissions",
      "--no-acls",
      "--no-fflags",
      "--no-xattrs",
      "--safe-writes",
    ],
  };
}
