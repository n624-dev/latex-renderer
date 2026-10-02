#!/usr/bin/env node
// Linux CI metrics, never a cache. GNU time includes CPU of waited descendants;
// its maximum RSS is a process high-water mark, not simultaneous tree memory.
import { spawn } from "node:child_process";
import { appendFile, mkdtemp, readFile, rm, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { clearInterval, setInterval } from "node:timers";

const [phase, separator, executable, ...args] = process.argv.slice(2);
if (
  process.platform !== "linux" ||
  !/^[a-z][a-z0-9-]{0,39}$/.test(phase ?? "") ||
  separator !== "--" ||
  !executable
)
  throw new Error(
    "Usage on Linux: measure-phase.mjs <phase> -- <command> [args]",
  );

const temporary = await mkdtemp(join(tmpdir(), "latex-ci-phase-"));
const report = join(temporary, "time.txt");
const started = performance.now();
const roots = [process.cwd(), tmpdir()];
const initialFree = await freeBytes();
const minimumFree = [...initialFree];
let sampler;
let child;
const signals = ["SIGINT", "SIGTERM"];
const forward = (signal) => {
  if (child?.pid) {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
};
const handlers = signals.map((signal) => [signal, () => forward(signal)]);
try {
  // No shell, command-line echo, environment dump, or persistent metric files.
  child = spawn(
    "/usr/bin/time",
    [
      "--quiet",
      "--format=%U,%S,%M",
      "--output",
      report,
      "--",
      executable,
      ...args,
    ],
    {
      stdio: "inherit",
      detached: true,
      env: { ...process.env, LC_NUMERIC: "C" },
    },
  );
  for (const [signal, handler] of handlers) process.on(signal, handler);
  let sampling = false;
  sampler = setInterval(() => {
    if (sampling) return;
    sampling = true;
    void freeBytes().then(
      (values) => {
        for (let i = 0; i < values.length; i++) {
          if (values[i] !== null)
            minimumFree[i] = Math.min(minimumFree[i] ?? Infinity, values[i]);
        }
        sampling = false;
      },
      () => {
        sampling = false;
      },
    );
  }, 1_000);
  const status = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  clearInterval(sampler);
  const finalFree = await freeBytes();
  for (let i = 0; i < finalFree.length; i++) {
    if (finalFree[i] !== null)
      minimumFree[i] = Math.min(minimumFree[i] ?? Infinity, finalFree[i]);
  }
  const elapsedSeconds = (performance.now() - started) / 1_000;
  const time = (await readFile(report, "utf8")).trim();
  const match = /^(\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+)$/m.exec(time);
  if (!match && !status.signal) throw new Error("Invalid GNU time measurement");
  const metrics = {
    phase,
    elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
    userCpuSeconds: match ? Number(match[1]) : null,
    systemCpuSeconds: match ? Number(match[2]) : null,
    maxProcessRssBytes: match ? Number(match[3]) * 1024 : null,
    minimumFilesystemFreeBytes: minimumFree,
    sampledFilesystemGrowthBytes: minimumFree.map((value, i) =>
      value === null || initialFree[i] === null
        ? null
        : Math.max(0, initialFree[i] - value),
    ),
    exitCode: status.code,
    signal: status.signal,
  };
  console.log(`CI_PHASE_METRICS ${JSON.stringify(metrics)}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `### ${phase}\n\nElapsed: ${metrics.elapsedSeconds}s; CPU: ${metrics.userCpuSeconds}s user + ${metrics.systemCpuSeconds}s system; maximum process RSS: ${metrics.maxProcessRssBytes} bytes; exit: ${status.code ?? status.signal}.\n\nFilesystem growth samples (workspace, temporary filesystem): ${JSON.stringify(metrics.sampledFilesystemGrowthBytes)} bytes. Samples are not an exact temporary-directory peak.\n\n`,
    );
  }
  process.exitCode = status.code ?? (status.signal === "SIGINT" ? 130 : 143);
} finally {
  clearInterval(sampler);
  for (const [signal, handler] of handlers) process.off(signal, handler);
  await rm(temporary, { recursive: true, force: true });
}

async function freeBytes() {
  return Promise.all(
    roots.map(async (root) => {
      try {
        const stats = await statfs(root);
        return stats.bavail * stats.bsize;
      } catch {
        return null;
      }
    }),
  );
}
