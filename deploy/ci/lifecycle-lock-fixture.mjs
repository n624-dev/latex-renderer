import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { setInterval } from "node:timers";
import { acquireInheritedMutationLockForPath } from "../scripts/inherited-mutation-lock.mjs";

// Fixed executable source; fixture paths are argv data, never JavaScript.
const [mode, lockPath, ready] = process.argv.slice(2);
if (mode === "child" && process.argv.length === 3) {
  setInterval(() => {}, 1000);
} else if (mode === "hold" && process.argv.length === 5) {
  const lock = await acquireInheritedMutationLockForPath(lockPath);
  spawn(process.execPath, [process.argv[1], "child"], {
    stdio: ["ignore", "ignore", "ignore", lock.fd],
  });
  await writeFile(ready, "ready");
  setInterval(() => {}, 1000);
} else throw new Error("Invalid lifecycle lock fixture arguments");
