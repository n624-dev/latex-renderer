import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { AppError } from "@latex-renderer/shared";
import {
  assertOutputDirectory,
  assertOutputFile,
  ensureSecureDirectory,
  optionalOutputStat,
} from "./output-safety.js";

const SUFFIX = ".latex-renderer-state";
const UUID = "[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}";
const CLAIM = new RegExp(`^claim-([1-9][0-9]*)-(${UUID})$`);
const GARBAGE = new RegExp(`^gc-${UUID}$`);
const MAX_ENTRIES = 10_000;
const MAX_BYTES = 1024 ** 3;
interface Journal {
  format: 1;
  output: string;
  previous: string | null;
  next: string;
}
type Tree = Map<
  string,
  {
    identity: string;
    size: number;
    mtime: number;
    ctime: number;
    directory: boolean;
  }
>;

function unsafe(message: string): never {
  throw new AppError("UNSAFE_ARTIFACT_TRANSACTION", message, 409);
}
async function identity(path: string): Promise<string> {
  // NTFS file IDs need not fit JavaScript's safe integer range.
  const info = await lstat(path, { bigint: true });
  return `${info.dev}:${info.ino}`;
}

/** The control directory is never uploaded, including for custom output names. */
export function isArtifactTransactionPath(path: string): boolean {
  return path
    .replaceAll("\\", "/")
    .split("/")
    .some((part) => part.toLowerCase().endsWith(SUFFIX));
}

/** Cooperative, fail-fast process exclusion. Claim names are unique and never reused.
 * No TTL can evict a paused/live writer. PID reuse conservatively reports busy.
 * Unlike unlinking a shared stale lock, reclaiming a dead unique claim cannot
 * accidentally remove a new owner's lock. Simultaneous contenders may both retry.
 */
async function acquire(state: string): Promise<() => Promise<void>> {
  const claim = join(state, `claim-${process.pid}-${randomUUID()}`);
  await mkdir(claim, { mode: 0o700 });
  try {
    const names = await readdir(state);
    if (names.length > 256) unsafe("Too many artifact transaction records");
    for (const name of names) {
      const path = join(state, name);
      if (path === claim) continue;
      const match = CLAIM.exec(name);
      if (match === null) {
        if (name !== "transaction" && !GARBAGE.test(name))
          unsafe("Unrecognized artifact transaction record");
        continue;
      }
      const info = await optionalOutputStat(path);
      if (info === undefined) continue;
      assertOutputDirectory(info);
      let alive = true;
      const pid = Number(match[1]);
      if (!Number.isSafeInteger(pid) || pid > 2 ** 31 - 1)
        unsafe("Invalid artifact transaction owner");
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false;
      }
      if (alive)
        throw new AppError(
          "OUTPUT_BUSY",
          "Another client is writing this output directory; retry after it finishes",
          409,
        );
      // Only empty, uniquely named claim directories are removed, never their contents.
      await rmdir(path).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
    }
    return () => rmdir(claim);
  } catch (error) {
    await rmdir(claim);
    throw error;
  }
}

async function tree(
  root: string,
  device: number,
  flush = false,
  cleanup = false,
): Promise<Tree> {
  const result: Tree = new Map();
  let bytes = 0;
  async function walk(path: string, name: string): Promise<void> {
    const info = await lstat(path);
    if (info.dev !== device)
      unsafe("Artifact output must not cross a filesystem mount");
    if (info.isDirectory()) assertOutputDirectory(info);
    else assertOutputFile(info);
    result.set(name, {
      identity: await identity(path),
      size: info.size,
      mtime: info.mtimeMs,
      ctime: info.ctimeMs,
      directory: info.isDirectory(),
    });
    if (result.size > (cleanup ? 2 * MAX_ENTRIES + 16 : MAX_ENTRIES))
      unsafe("Artifact output contains too many entries (maximum 10000)");
    if (info.isDirectory()) {
      for (const entry of (await readdir(path)).sort())
        await walk(join(path, entry), name === "" ? entry : `${name}/${entry}`);
    } else {
      bytes += info.size;
      if (bytes > (cleanup ? 2 * MAX_BYTES + 65_536 : MAX_BYTES))
        unsafe("Artifact output exceeds the 1 GiB transaction limit");
    }
    if (flush) await sync(path, info.isDirectory());
  }
  await walk(root, "");
  return result;
}

async function sync(path: string, directory = true): Promise<void> {
  // Windows does not support opening directories for fsync. Process-crash
  // recovery is supported there; a hardware/power-loss atomicity guarantee is not.
  if (directory && process.platform === "win32") return;
  // Windows FlushFileBuffers requires a writable handle. Only staged regular
  // files use r+ (no creation/truncation); POSIX directory handles remain read-only.
  const handle = await open(path, process.platform === "win32" ? "r+" : "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeRecord(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.part`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
  await sync(dirname(path));
}

async function readRecord(path: string): Promise<unknown> {
  const info = await lstat(path);
  assertOutputFile(info);
  if (info.size > 16_384) unsafe("Artifact transaction record is too large");
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return unsafe(
      "Artifact transaction record is corrupt; previous output was preserved",
    );
  }
}

async function removeTree(path: string, device: number): Promise<void> {
  await tree(path, device, false, true);
  await rm(path, { recursive: true });
}

async function discardTransaction(
  state: string,
  device: number,
): Promise<void> {
  const garbage = join(state, `gc-${randomUUID()}`);
  await rename(join(state, "transaction"), garbage);
  await sync(state);
  await removeTree(garbage, device);
}

async function recover(
  state: string,
  output: string,
  device: number,
): Promise<void> {
  for (const name of await readdir(state)) {
    if (GARBAGE.test(name)) await removeTree(join(state, name), device);
  }
  const transaction = join(state, "transaction");
  const info = await optionalOutputStat(transaction);
  if (info === undefined) return;
  assertOutputDirectory(info);
  if (info.dev !== device)
    unsafe("Artifact transaction is on another filesystem");
  if (
    (await readdir(transaction)).some(
      (name) =>
        ![
          "stage",
          "backup",
          "journal.json",
          "journal.json.part",
          "committed.json",
          "committed.json.part",
        ].includes(name),
    )
  )
    unsafe("Unrecognized artifact recovery record; nothing was deleted");
  const stage = join(transaction, "stage"),
    backup = join(transaction, "backup");
  const journalPath = join(transaction, "journal.json");
  if ((await optionalOutputStat(journalPath)) === undefined) {
    const names = await readdir(transaction);
    if (names.some((name) => !["stage", "journal.json.part"].includes(name)))
      unsafe(
        "Artifact recovery journal is missing; previous output was preserved",
      );
    await discardTransaction(state, device);
    return;
  }
  const value = (await readRecord(journalPath)) as Partial<Journal> | null;
  if (
    !value ||
    value.format !== 1 ||
    value.output !== output ||
    !(
      value.previous === null ||
      (typeof value.previous === "string" && /^\d+:\d+$/.test(value.previous))
    ) ||
    typeof value.next !== "string" ||
    !/^\d+:\d+$/.test(value.next) ||
    value.next === value.previous
  )
    unsafe(
      "Artifact recovery journal is invalid; previous output was preserved",
    );
  const current = await optionalOutputStat(output),
    saved = await optionalOutputStat(backup),
    staged = await optionalOutputStat(stage);
  for (const directory of [current, saved, staged]) {
    if (directory !== undefined) {
      assertOutputDirectory(directory);
      if (directory.dev !== device)
        unsafe("Artifact recovery must not cross a filesystem mount");
    }
  }
  if (saved !== undefined && (await identity(backup)) !== value.previous)
    unsafe("Previous artifact directory has changed");
  if (staged !== undefined && (await identity(stage)) !== value.next)
    unsafe("Staged artifact directory has changed");
  const committedPath = join(transaction, "committed.json");
  if ((await optionalOutputStat(committedPath)) !== undefined) {
    const committed = await readRecord(committedPath);
    if (
      committed !== value.next ||
      current === undefined ||
      (await identity(output)) !== value.next ||
      staged !== undefined
    )
      unsafe("Committed artifact directory has changed");
    await discardTransaction(state, device);
    return;
  }
  if (current !== undefined && (await identity(output)) === value.next) {
    if (
      staged !== undefined ||
      (value.previous !== null && saved === undefined)
    )
      unsafe("Previous artifact directory is missing");
    await rename(output, stage);
    await sync(dirname(output));
  } else if (
    current !== undefined &&
    ((await identity(output)) !== value.previous || saved !== undefined)
  ) {
    unsafe("Output directory changed during recovery; nothing was overwritten");
  }
  if (
    value.previous !== null &&
    (await optionalOutputStat(output)) === undefined
  ) {
    if (saved === undefined) unsafe("Previous artifact directory is missing");
    await rename(backup, output);
    await sync(dirname(output));
  }
  await discardTransaction(state, device);
}

/** Stage a complete set, then switch fixed paths with a brief directory gap.
 * A journal written before either rename restores the previous set on failure
 * or the next call after SIGKILL. A durable commit marker finishes cleanup only.
 */
export async function publishArtifactSet<T>(
  requestedOutput: string,
  build: (stage: string) => Promise<T>,
): Promise<T> {
  const requested = resolve(requestedOutput),
    parent = dirname(requested);
  if (
    parent === requested ||
    basename(requested).toLowerCase().endsWith(SUFFIX)
  )
    unsafe("Invalid artifact output directory");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const canonicalParent = await realpath(parent),
    output = join(canonicalParent, basename(requested));
  const parentInfo = await lstat(canonicalParent);
  // A sticky temporary parent also prevents other users from replacing our
  // owned output/state entries. A plain shared writable directory does not.
  if (process.platform === "win32" || (parentInfo.mode & 0o1000) === 0)
    assertOutputDirectory(parentInfo);
  const device = parentInfo.dev;
  const state = `${output}${SUFFIX}`;
  await ensureSecureDirectory(state);
  if ((await lstat(state)).dev !== device)
    unsafe("Artifact state must be on the output filesystem");
  const release = await acquire(state);
  let started = false,
    committed = false;
  try {
    await recover(state, output, device);
    const existing = await optionalOutputStat(output);
    const original =
      existing === undefined ? undefined : await tree(output, device);
    const transaction = join(state, "transaction"),
      stage = join(transaction, "stage"),
      backup = join(transaction, "backup");
    await mkdir(transaction, { mode: 0o700 });
    started = true;
    await mkdir(stage, { mode: 0o700 });
    const journal: Journal = {
      format: 1,
      output,
      previous: existing === undefined ? null : await identity(output),
      next: await identity(stage),
    };
    await writeRecord(join(transaction, "journal.json"), journal);
    await sync(state);
    // Preserve user-created files; obsolete generated files are pruned in the
    // private copy. Never hardlink mutable client output into a new generation.
    for (const [name, entry] of original ?? []) {
      if (name === "") continue;
      if (entry.directory) await mkdir(join(stage, name), { mode: 0o700 });
      else
        await copyFile(
          join(output, name),
          join(stage, name),
          constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE,
        );
    }
    const result = await build(stage);
    await tree(stage, device, true);
    if ((await realpath(parent)) !== canonicalParent)
      unsafe("Artifact output parent has changed");
    const current = await optionalOutputStat(output);
    if (
      JSON.stringify(original === undefined ? null : [...original]) !==
      JSON.stringify(
        current === undefined ? null : [...(await tree(output, device))],
      )
    )
      unsafe(
        "Artifact output was edited during download; previous output was preserved",
      );
    if (existing !== undefined) await rename(output, backup);
    await sync(canonicalParent);
    await sync(transaction);
    await rename(stage, output);
    await sync(canonicalParent);
    await sync(transaction);
    await writeRecord(join(transaction, "committed.json"), journal.next);
    committed = true;
    try {
      await discardTransaction(state, device);
    } catch {
      process.emitWarning(
        "Artifact set saved; temporary cleanup will retry on next download",
        { code: "ARTIFACT_CLEANUP_PENDING" },
      );
    }
    return result;
  } catch (error) {
    if (started && !committed) {
      // A normal failure while flushing the commit record is not a successful
      // publication. Remove our marker before rolling back. Crash recovery, in
      // contrast, accepts a complete marker found on disk as the commit point.
      await rm(join(state, "transaction", "committed.json"), { force: true });
      await recover(state, output, device);
    }
    throw error;
  } finally {
    await release();
  }
}
