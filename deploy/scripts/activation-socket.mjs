import { fstatSync, readFileSync, readlinkSync } from "node:fs";

export function assertUnixListener(descriptor, path) {
  if (!fstatSync(descriptor).isSocket())
    throw new Error("Activation descriptor is not a socket");
  const inode = /^socket:\[(\d+)\]$/.exec(
    readlinkSync(`/proc/self/fd/${descriptor}`),
  )?.[1];
  if (
    !inode ||
    !readFileSync("/proc/net/unix", "utf8")
      .split("\n")
      .some((line) => {
        const fields = line.trim().split(/\s+/);
        return (
          fields[6] === inode &&
          fields[7] === path &&
          fields[3] === "00010000" &&
          fields[4] === "0001"
        );
      })
  )
    throw new Error("Unexpected Unix activation address");
}
