import {
  constants,
  openSync,
  fstatSync,
  readSync,
  closeSync,
  realpathSync,
} from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { createHash } from "node:crypto";
import { readLanHttpsConfiguration } from "./configuration.mjs";

export function lanHttpsBinary() {
  const architecture =
    process.arch === "x64"
      ? "amd64"
      : process.arch === "arm64"
        ? "arm64"
        : null;
  if (process.platform !== "linux" || !architecture)
    throw new Error("LAN HTTPS supports Linux amd64/arm64");
  const manifestPath = realpathSync(
    fileURLToPath(new URL("./binaries.json", import.meta.url)),
  );
  const manifest = readLanHttpsConfiguration(manifestPath);
  const value = manifest?.binaries?.[architecture];
  if (
    manifest.format !== 1 ||
    !/^\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/.test(manifest.version) ||
    !/^[a-f0-9]{40}$/.test(manifest.commit) ||
    value?.path !== `bin/lan-https-linux-${architecture}` ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 1 ||
    value.bytes > 20 * 1024 * 1024
  )
    throw new Error("Invalid LAN HTTPS binary manifest");
  const path = realpathSync(
    fileURLToPath(new URL(`./${value.path}`, import.meta.url)),
  );
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = fstatSync(fd);
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      ![0, process.geteuid()].includes(before.uid) ||
      ![0o750, 0o755].includes(before.mode & 0o7777) ||
      before.size !== value.bytes
    )
      throw new Error("LAN HTTPS executable is unsafe");
    const chunk = Buffer.alloc(65536),
      digest = createHash("sha256");
    let bytes = 0;
    while (true) {
      const count = readSync(fd, chunk, 0, chunk.length, null);
      if (!count) break;
      if (
        !bytes &&
        (count < 20 ||
          chunk.subarray(0, 4).toString("hex") !== "7f454c46" ||
          chunk[4] !== 2 ||
          chunk[5] !== 1 ||
          chunk.readUInt16LE(18) !== (architecture === "amd64" ? 62 : 183))
      )
        throw new Error("LAN HTTPS executable architecture mismatch");
      bytes += count;
      if (bytes > value.bytes) throw new Error("LAN HTTPS executable changed");
      digest.update(chunk.subarray(0, count));
    }
    const after = fstatSync(fd);
    if (
      bytes !== value.bytes ||
      digest.digest("hex") !== value.sha256 ||
      after.size !== before.size ||
      after.ctimeMs !== before.ctimeMs ||
      after.mtimeMs !== before.mtimeMs
    )
      throw new Error("LAN HTTPS executable checksum mismatch");
  } finally {
    closeSync(fd);
  }
  return path;
}
