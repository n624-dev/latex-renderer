import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { runCiProcessGroup } from "../deploy/ci/process-group.mjs";

it.skipIf(process.platform !== "linux")(
  "reclaims descendants that ignore termination at the CI deadline",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "ci-process-group-"));
    const report = join(directory, "pids.json");
    try {
      const fixture = `const {spawn}=require("node:child_process"),fs=require("node:fs");
      process.on("SIGTERM",()=>{});
      const child=spawn(process.execPath,["-e",'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:"inherit"});
      fs.writeFileSync(process.argv[1],JSON.stringify([process.pid,child.pid]));
      setInterval(()=>{},1000);`;
      await expect(
        runCiProcessGroup(process.execPath, ["-e", fixture, report], {
          timeoutMs: 1000,
          graceMs: 200,
        }),
      ).rejects.toThrow("timed out");
      const pids = JSON.parse(readFileSync(report, "utf8")) as number[];
      expect(pids).toHaveLength(2);
      expect(pids.every((pid) => Number.isSafeInteger(pid) && pid > 1)).toBe(
        true,
      );
      // Reparented grandchildren may briefly be zombies until init reaps them;
      // neither a live process nor an inherited output pipe may remain.
      for (const pid of pids) {
        let state = "?";
        for (let attempt = 0; attempt < 50; attempt++) {
          try {
            state =
              readFileSync(`/proc/${pid}/stat`, "utf8")
                .split(") ")[1]
                ?.split(" ")[0] ?? "?";
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            state = "X";
          }
          if (["X", "Z"].includes(state)) break;
          await delay(20);
        }
        expect(["X", "Z"]).toContain(state);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform !== "linux")(
  "accepts a completed process and reports nonzero exits",
  async () => {
    await expect(
      runCiProcessGroup(process.execPath, ["-e", "process.exit(0)"]),
    ).resolves.toBeUndefined();
    await expect(
      runCiProcessGroup(process.execPath, ["-e", "process.exit(7)"]),
    ).rejects.toThrow("unsuccessfully");
  },
);
