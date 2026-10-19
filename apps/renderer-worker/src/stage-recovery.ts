import { lstat, readFile, readdir, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { RendererDatabase, StaleLeaseRow } from "@latex-renderer/database";
import { nowIso } from "@latex-renderer/shared";
import type { WorkerConfig } from "./config.js";

/** Called only after the recovery lease fences the old Worker AND every daemon
 * container for that Job has been proven stopped. No published reference or
 * transfer lease may be discarded, including a PDF retained across SVG failure. */
export async function pruneRecoveredStageAttempt(
  db: RendererDatabase,
  config: Pick<
    WorkerConfig,
    | "storageRoot"
    | "maxZipEntries"
    | "maxFileCount"
    | "maxOutputFileCount"
    | "maxOutputDirectoryCount"
  >,
  job: StaleLeaseRow,
  recoveryOwner: string,
  recoveryGeneration: number,
): Promise<void> {
  const checkpoint = db.outputStages.checkpoint(job.id);
  if (!checkpoint || process.platform !== "linux") return;
  if (!/^job_[a-f0-9]{32}$/.test(job.id))
    throw new Error("Unsafe recovered Job ID");
  const pdfGeneration = job.lease_generation * 2,
    svgGeneration = pdfGeneration + 1;
  if (!Number.isSafeInteger(svgGeneration) || pdfGeneration <= 0)
    throw new Error("Unsafe recovered stage generation");
  const stillOwned = () => {
    const row = db.worker.runtimeState(job.id);
    return (
      row?.lease_owner === recoveryOwner &&
      row.lease_generation === recoveryGeneration &&
      ["validating", "running", "canceled"].includes(row.status)
    );
  };
  const references = db.transaction(() => {
    if (!stillOwned() || db.artifacts.hasActiveTransfers(job.id, nowIso()))
      return undefined;
    const result = new Set(db.artifacts.referencedGenerations(job.id));
    if (checkpoint.pdf_generation !== null)
      result.add(checkpoint.pdf_generation);
    if (checkpoint.svg_generation !== null)
      result.add(checkpoint.svg_generation);
    return result;
  });
  if (!references) return;
  const storage = resolve(config.storageRoot),
    root = join(storage, "jobs", job.id);
  let rootStat;
  try {
    rootStat = await lstat(root);
  } catch (error) {
    if (code(error) === "ENOENT") return;
    throw error;
  }
  if (
    (await realpath(storage)) !== storage ||
    (await realpath(root)) !== root ||
    !rootStat.isDirectory() ||
    rootStat.dev !== (await lstat(storage)).dev
  )
    throw new Error("Unsafe recovered Job directory");
  const mounts = (await readFile("/proc/self/mountinfo", "utf8"))
    .split("\n")
    .map((line) => line.split(" ")[4])
    .filter((p): p is string => p !== undefined)
    .map((p) =>
      p.replace(/\\([0-7]{3})/g, (_, octal: string) =>
        String.fromCharCode(Number.parseInt(octal, 8)),
      ),
    );
  if (mounts.some((p) => p === root || p.startsWith(root + "/")))
    throw new Error("Unexpected mount in recovered Job");
  const targets = [
    join(root, "attempts", String(job.lease_generation)),
    ...[pdfGeneration, svgGeneration]
      .filter((g) => !references.has(g))
      .map((g) => join(root, "outputs", String(g))),
  ];
  for (const path of targets) {
    let stat;
    try {
      stat = await lstat(path);
    } catch (error) {
      if (code(error) === "ENOENT") continue;
      throw error;
    }
    if (
      !stat.isDirectory() ||
      stat.dev !== rootStat.dev ||
      (await realpath(path)) !== path
    )
      throw new Error("Unsafe recovered stage directory");
    // Walk without following symlinks and refuse device changes. fs.rm unlinks
    // symlinks; it does not descend into their targets. The stopped old sandbox
    // cannot race this validation with further filesystem writes.
    let checked = 0;
    const pending = [path],
      limit =
        4 *
        (config.maxZipEntries +
          config.maxFileCount +
          config.maxOutputFileCount +
          config.maxOutputDirectoryCount);
    while (pending.length) {
      const directory = pending.pop();
      if (directory === undefined) break;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (++checked > limit)
          throw new Error("Recovered stage exceeds cleanup entry budget");
        const child = join(directory, entry.name),
          info = await lstat(child);
        if (info.dev !== rootStat.dev)
          throw new Error("Unexpected device in recovered stage");
        if (info.isDirectory()) pending.push(child);
      }
    }
    if (!stillOwned()) return;
    await rm(path, { recursive: true, force: true });
  }
}

function code(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : undefined;
}
