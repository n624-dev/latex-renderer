import { spawn } from "node:child_process";
import { setTimeout, clearTimeout } from "node:timers";
import { readdirSync, readFileSync } from "node:fs";

/** Internal prepared-host commands only. Secrets use stdin, never argv/env/logs.
 * Wait for the child to close before returning; a deadline remains a failure
 * even if a TERM handler exits zero. Kill the private process group when needed
 * so a runuser wrapper cannot leave an owner operation running after failure.
 */
export async function runServerSetupChild(
  command,
  args,
  input,
  { timeoutMs, maxOutputBytes = 0, killGraceMs = 2000 },
) {
  if (
    process.platform !== "linux" ||
    typeof command !== "string" ||
    !command.startsWith("/") ||
    !Array.isArray(args) ||
    args.some((arg) => typeof arg !== "string") ||
    typeof input !== "string" ||
    Buffer.byteLength(input) > 32 * 1024 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60_000 ||
    !Number.isSafeInteger(maxOutputBytes) ||
    maxOutputBytes < 0 ||
    maxOutputBytes > 1024 ||
    !Number.isSafeInteger(killGraceMs) ||
    killGraceMs < 1 ||
    killGraceMs > 2000
  )
    throw new Error("Invalid prepared setup child request");
  const bytes = Buffer.from(input);
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        detached: true,
        env: { PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8" },
        stdio: ["pipe", maxOutputBytes ? "pipe" : "ignore", "ignore"],
      });
      const chunks = [];
      let length = 0,
        failure = null,
        closed = false,
        code = null,
        forced = false,
        escalation,
        confirmation,
        confirmationDelay = 25;
      const groupExists = () => {
        if (!child.pid) return false;
        try {
          process.kill(-child.pid, 0);
          return true;
        } catch (error) {
          return error.code !== "ESRCH";
        }
      };
      const signalGroup = (signal) => {
        if (!child.pid) return;
        try {
          process.kill(-child.pid, signal);
        } catch (error) {
          // A group that has already exited is not a termination failure.
          if (error.code !== "ESRCH")
            failure = "Setup child termination failed";
        }
      };
      const runningGroup = () => {
        // kill(2) returning does NOT prove a descendant has stopped executing.
        // Inspect only numeric Linux proc entries, compare this private PGID,
        // and ignore zombies (no code/DB writes) awaiting init reaping.
        for (const pid of readdirSync("/proc")) {
          if (!/^[0-9]+$/.test(pid)) continue;
          let stat;
          try {
            stat = readFileSync(`/proc/${pid}/stat`, "utf8");
          } catch (error) {
            if (["ENOENT", "ESRCH"].includes(error.code)) continue;
            return true; // Cannot prove termination: retain the mutation lock.
          }
          const fields = stat.slice(stat.lastIndexOf(") ") + 2).split(" ");
          if (
            Number(fields[2]) === child.pid &&
            !["Z", "X"].includes(fields[0])
          )
            return true;
        }
        return false;
      };
      const finish = () => {
        if (!closed || (failure && !forced && groupExists())) return;
        if (failure && forced && runningGroup()) {
          confirmation = setTimeout(finish, confirmationDelay);
          confirmationDelay = Math.min(confirmationDelay * 2, 1000);
          return;
        }
        clearTimeout(deadline);
        clearTimeout(escalation);
        clearTimeout(confirmation);
        const output = Buffer.concat(chunks).toString("utf8");
        for (const chunk of chunks) chunk.fill(0);
        chunks.length = 0;
        if (failure || code !== 0)
          reject(new Error(failure ?? "Prepared setup child failed"));
        else resolve(output);
      };
      const terminate = (reason) => {
        if (failure) return;
        failure = reason;
        signalGroup("SIGTERM");
        escalation = setTimeout(() => {
          signalGroup("SIGKILL");
          forced = true;
          finish();
        }, killGraceMs);
      };
      const deadline = setTimeout(
        () => terminate("Prepared setup child timed out"),
        timeoutMs,
      );
      child.on("error", () => terminate("Prepared setup child failed"));
      child.on("exit", (exitCode) => {
        if (exitCode !== 0) terminate("Prepared setup child failed");
      });
      child.stdin.on("error", () =>
        terminate("Prepared setup child input failed"),
      );
      child.stdout?.on("error", () =>
        terminate("Prepared setup child output failed"),
      );
      child.stdout?.on("data", (chunk) => {
        if (failure) return;
        if (length + chunk.length > maxOutputBytes) {
          terminate("Prepared setup child output limit exceeded");
          return;
        }
        chunks.push(chunk);
        length += chunk.length;
      });
      child.on("close", (exitCode) => {
        closed = true;
        code = exitCode;
        finish();
      });
      child.stdin.end(bytes, () => bytes.fill(0));
    });
  } finally {
    bytes.fill(0);
  }
}
