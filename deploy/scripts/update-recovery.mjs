import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  statfs,
  writeFile,
} from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { setTimeout, clearTimeout } from "node:timers";

const GiB = 1024 ** 3,
  MiB = 1024 ** 2;
const pointId = /^rp-[0-9]{13}-[a-f0-9]{12}$/;
export function recoveryPolicy(value = {}) {
  const defaults = {
    maxBytes: 4 * GiB,
    minFreeBytes: 3 * GiB,
    retainCount: 2,
    retainHours: 168,
    maxEntries: 100_000,
  };
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error("Recovery policy must be a plain object");
  if (Reflect.ownKeys(value).some((key) => !Object.hasOwn(defaults, key)))
    throw new Error("Unknown recovery policy setting");
  const result = { ...defaults, ...value };
  for (const [key, number] of Object.entries(result))
    if (
      !Number.isSafeInteger(number) ||
      number < (key === "minFreeBytes" ? 0 : 1)
    )
      throw new Error("Invalid recovery policy");
  if (
    result.maxBytes > 64 * GiB ||
    result.retainCount > 20 ||
    result.retainHours > 24 * 365 ||
    result.maxEntries > 1_000_000
  )
    throw new Error("Recovery policy exceeds supported bounds");
  return result;
}

async function digest(path) {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = await file.stat();
    if (!info.isFile())
      throw new Error("Recovery input must be a regular file");
    const hash = createHash("sha256"),
      buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    while (position < info.size) {
      const { bytesRead } = await file.read(
        buffer,
        0,
        Math.min(buffer.length, info.size - position),
        position,
      );
      if (!bytesRead) throw new Error("Recovery input was truncated");
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await file.stat();
    if (
      after.size !== info.size ||
      after.mtimeMs !== info.mtimeMs ||
      after.ctimeMs !== info.ctimeMs
    )
      throw new Error("Recovery input changed during verification");
    return { bytes: info.size, sha256: hash.digest("hex") };
  } finally {
    await file.close();
  }
}

async function copyBounded(input, output, expectedBytes) {
  const source = await open(
    input,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let target;
  try {
    const before = await source.stat();
    if (!before.isFile() || before.size !== expectedBytes)
      throw new Error("Recovery input changed before copying");
    target = await open(output, "wx", 0o600);
    const buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    while (position < expectedBytes) {
      const { bytesRead } = await source.read(
        buffer,
        0,
        Math.min(buffer.length, expectedBytes - position),
        position,
      );
      if (!bytesRead) throw new Error("Recovery input truncated while copying");
      await target.writeFile(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await source.stat();
    if (
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw new Error("Recovery input changed while copying");
  } finally {
    await source.close();
    await target?.close();
  }
}

async function mounts() {
  return (await readFile("/proc/self/mountinfo", "utf8"))
    .split("\n")
    .map((line) =>
      line
        .split(" ")[4]
        ?.replace(/\\([0-7]{3})/g, (_, octal) =>
          String.fromCharCode(parseInt(octal, 8)),
        ),
    )
    .filter(Boolean);
}

async function tree(root, maximum, sealed = false) {
  root = resolve(root);
  const base = await lstat(root),
    mounted = await mounts();
  if (!base.isDirectory() || (await realpath(root)) !== root)
    throw new Error("Unsafe recovery tree root");
  const files = [],
    directories = [],
    seen = new Set();
  let bytes = 0,
    allocated = 0,
    entries = 0;
  const visit = async (relative) => {
    if (++entries > maximum)
      throw new Error("Recovery tree has too many entries");
    const path = relative ? join(root, relative) : root,
      info = await lstat(path);
    if (
      info.isSymbolicLink() ||
      info.dev !== base.dev ||
      (relative && mounted.includes(path)) ||
      (!info.isFile() && !info.isDirectory()) ||
      (sealed && (info.uid !== process.getuid() || info.mode & 0o077))
    )
      throw new Error("Unsafe entry in recovery tree");
    if (!seen.has(`${info.dev}:${info.ino}`)) {
      allocated += info.blocks * 512;
      seen.add(`${info.dev}:${info.ino}`);
    }
    if (info.isDirectory()) {
      directories.push(relative);
      for (const name of (await readdir(path)).sort())
        await visit(relative ? `${relative}/${name}` : name);
    } else {
      bytes += info.size;
      files.push({
        path: relative,
        bytes: info.size,
        mtimeMs: info.mtimeMs,
        ctimeMs: info.ctimeMs,
      });
    }
  };
  await visit("");
  return { files, directories, bytes, allocated, entries };
}

function checkDatabase(path) {
  // Only private snapshot/decrypted copies reach this function. Node24.15 /
  // SQLite3.51.3 can omit CHECK violations from a read-only integrity_check;
  // never open the live source read-write to work around that behavior.
  const db = new DatabaseSync(path);
  try {
    if (
      db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok" ||
      db.prepare("PRAGMA foreign_key_check").all().length
    )
      throw new Error("Recovery database verification failed");
    const sqliteUserVersion = db
      .prepare("PRAGMA user_version")
      .get()?.user_version;
    const migrations = db
      .prepare("SELECT type FROM sqlite_schema WHERE name='schema_migrations'")
      .get();
    let applicationSchemaVersion = null;
    if (migrations !== undefined) {
      if (
        migrations.type !== "table" ||
        db
          .prepare(
            "SELECT 1 FROM schema_migrations WHERE typeof(version)!='integer' OR version<1 OR version>9007199254740991 LIMIT 1",
          )
          .get()
      )
        throw new Error("Invalid recovery application migration history");
      applicationSchemaVersion = db
        .prepare(
          "SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations",
        )
        .get().version;
    }
    return { sqliteUserVersion, applicationSchemaVersion };
  } finally {
    db.close();
  }
}

async function commandPipe(first, second, maximum) {
  const children = [],
    done = [];
  const start = ([command, ...args]) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    children.push(child);
    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr = (stderr + data).slice(-2048);
    });
    const closed = new Promise((accept, reject) => {
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0
          ? accept()
          : reject(new Error(`Recovery ${command} failed: ${stderr}`)),
      );
    });
    closed.catch(() => {});
    done.push(closed);
    return child;
  };
  const timer = setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
  }, 30 * 60_000);
  try {
    const source = start(first),
      target = start(second);
    source.stdin.end();
    target.stdout.resume();
    let bytes = 0;
    const limit = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        callback(
          bytes > maximum
            ? new Error("Recovery stream exceeds capacity estimate")
            : null,
          chunk,
        );
      },
    });
    await Promise.all([...done, pipeline(source.stdout, limit, target.stdin)]);
  } catch (error) {
    throw new Error(
      `Recovery pipe ${first[0]} -> ${second[0]} failed: ${error.message}`,
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
    for (const child of children)
      if (child.exitCode === null) child.kill("SIGKILL");
    await Promise.allSettled(done);
  }
}

export class RecoveryStore {
  constructor(root, policy = recoveryPolicy()) {
    this.root = resolve(root);
    this.policy = recoveryPolicy(policy);
  }
  async initialize() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const info = await lstat(this.root);
    if (
      !info.isDirectory() ||
      info.uid !== process.getuid() ||
      info.mode & 0o077 ||
      (await realpath(this.root)) !== this.root
    )
      throw new Error(
        "Recovery store must be private and owned by its operator",
      );
    for (const name of ["points", "staging", "trash"])
      await mkdir(join(this.root, name), { mode: 0o700 }).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
    await tree(this.root, this.policy.maxEntries * 4, true);
  }
  async atomic(name, value) {
    if (name !== "operation.json")
      throw new Error("Invalid recovery state name");
    const temporary = join(
      this.root,
      `.state-${randomBytes(6).toString("hex")}`,
    );
    const file = await open(temporary, "wx", 0o600);
    try {
      try {
        await file.writeFile(JSON.stringify(value) + "\n");
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, join(this.root, name));
      await this.sync();
    } finally {
      await rm(temporary, { force: true });
    }
  }
  async sync() {
    const dir = await open(this.root, "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  }
  async points() {
    const result = [];
    for (const id of await readdir(join(this.root, "points"))) {
      if (!pointId.test(id)) throw new Error("Unknown recovery point entry");
      const path = join(this.root, "points", id);
      await tree(path, this.policy.maxEntries, true);
      if ((await lstat(join(path, "summary.json"))).size > 64 * 1024)
        throw new Error("Unbounded recovery metadata");
      const value = JSON.parse(
        await readFile(join(path, "summary.json"), "utf8"),
      );
      if (
        value.format !== 1 ||
        value.id !== id ||
        !Number.isSafeInteger(value.createdAt) ||
        !Number.isSafeInteger(value.archive?.bytes) ||
        value.archive.bytes < 1 ||
        !/^[a-f0-9]{64}$/.test(value.archive.sha256 ?? "")
      )
        throw new Error("Corrupt recovery point metadata");
      // Additive format-1 metadata: old points keep their legacy schema field
      // and remain readable without rewriting either summary or archive.
      if (
        Object.hasOwn(value, "sqliteUserVersion") ||
        Object.hasOwn(value, "applicationSchemaVersion")
      ) {
        if (
          !Number.isInteger(value.sqliteUserVersion) ||
          value.sqliteUserVersion < -2147483648 ||
          value.sqliteUserVersion > 2147483647 ||
          value.schema !== value.sqliteUserVersion ||
          !(
            value.applicationSchemaVersion === null ||
            (Number.isSafeInteger(value.applicationSchemaVersion) &&
              value.applicationSchemaVersion >= 0)
          )
        )
          throw new Error("Corrupt recovery database version metadata");
      }
      const archive = await lstat(join(path, "recovery.tar.age"));
      if (!archive.isFile() || archive.size !== value.archive.bytes)
        throw new Error("Incomplete recovery point");
      if (
        (await digest(join(path, "recovery.tar.age"))).sha256 !==
        value.archive.sha256
      )
        throw new Error("Corrupt recovery archive");
      result.push(value);
    }
    return result.sort(
      (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id),
    );
  }
  async remove(path) {
    const relative = path.slice(this.root.length + 1);
    if (
      !path.startsWith(`${this.root}/`) ||
      !/^(?:staging\/work-[A-Za-z0-9]{6}|trash\/rp-[0-9]{13}-[a-f0-9]{12})$/.test(
        relative,
      )
    )
      throw new Error("Invalid recovery removal target");
    // Called only with IDs validated by points()/collect(), after inspection of
    // the complete tree. Never follow a link or bind mount during removal.
    await tree(path, this.policy.maxEntries * 4, true);
    await rm(path, { recursive: true });
    await this.sync();
  }
  async discard(id) {
    if (!pointId.test(id)) throw new Error("Invalid recovery point ID");
    const source = join(this.root, "points", id);
    await tree(source, this.policy.maxEntries, true);
    const target = join(this.root, "trash", id);
    await rename(source, target);
    for (const name of ["points", "trash"]) {
      const directory = await open(join(this.root, name), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
    await this.remove(target);
  }
  async usage() {
    return (await tree(this.root, this.policy.maxEntries * 4, true)).allocated;
  }
  async collect({
    protectedId = null,
    now = Date.now(),
    additionalBytes = 0,
  } = {}) {
    await this.initialize();
    // Renamed points are no longer selectable. An interrupted recursive delete
    // can be resumed without treating its partial metadata as a completed point.
    for (const id of await readdir(join(this.root, "trash"))) {
      if (!pointId.test(id)) throw new Error("Unknown recovery trash entry");
      await this.remove(join(this.root, "trash", id));
    }
    for (const name of await readdir(this.root)) {
      if (/^\.state-[a-f0-9]{12}$/.test(name)) {
        const path = join(this.root, name);
        if (!(await lstat(path)).isFile())
          throw new Error("Unsafe recovery temporary state");
        await rm(path);
      }
    }
    for (const name of await readdir(join(this.root, "staging"))) {
      if (!/^work-[A-Za-z0-9]{6}$/.test(name))
        throw new Error("Unknown recovery staging entry");
      await this.remove(join(this.root, "staging", name));
    }
    const points = await this.points();
    for (let index = points.length - 1; index >= 0; index--) {
      const point = points[index];
      if (point.id === protectedId) continue;
      const expired =
        now - point.createdAt > this.policy.retainHours * 3600_000;
      const overCount = index >= this.policy.retainCount;
      // During admission, preserve the newest existing point until a verified
      // replacement exists. Never use a deleted point's logical size as free space.
      const pressure =
        index > 0 &&
        (await this.usage()) + additionalBytes > this.policy.maxBytes;
      if (expired || overCount || pressure) await this.discard(point.id);
    }
  }
  async create({
    database,
    storage,
    recipient,
    identity,
    release,
    now = Date.now(),
  }) {
    await this.collect({ now });
    const inventory = await tree(storage, this.policy.maxEntries);
    const dbInfo = await lstat(database);
    if (!dbInfo.isFile() || (await realpath(database)) !== resolve(database))
      throw new Error("Unsafe recovery database");
    // WAL can contain committed pages not yet reflected in the main file size.
    const databaseView = new DatabaseSync(database, { readOnly: true });
    let databaseBytes;
    try {
      databaseBytes = Math.max(
        dbInfo.size,
        databaseView.prepare("PRAGMA page_count").get().page_count *
          databaseView.prepare("PRAGMA page_size").get().page_size,
      );
    } finally {
      databaseView.close();
    }
    // Three live copies: plaintext snapshot, encrypted tar, and decrypted
    // verification tree. Include directory/tar/SQLite/metadata overhead.
    const single =
      inventory.bytes + 2 * databaseBytes + inventory.entries * 8192 + 64 * MiB;
    const peak = single * 3;
    if (!Number.isSafeInteger(peak))
      throw new Error("Invalid recovery capacity estimate");
    await this.collect({ now, additionalBytes: peak });
    const free = await statfs(this.root, { bigint: true });
    if (
      (await this.usage()) + peak > this.policy.maxBytes ||
      free.bavail * free.bsize < BigInt(peak + this.policy.minFreeBytes)
    )
      throw new Error(
        "RECOVERY_CAPACITY_BLOCKED: verified recovery point cannot fit its working peak",
      );
    const work = await mkdtemp(join(this.root, "staging/work-"));
    const id = `rp-${now}-${randomBytes(6).toString("hex")}`;
    if (!pointId.test(id)) throw new Error("Invalid recovery point time");
    try {
      const data = join(work, "data"),
        verified = join(work, "verified");
      await mkdir(data, { mode: 0o700 });
      await mkdir(verified, { mode: 0o700 });
      // VACUUM may leave an incomplete destination on ENOSPC. Make it private
      // from creation, not only by chmod after success, so safe GC can recover it.
      // VACUUM INTO explicitly supports an existing empty destination file.
      const destination = await open(
        join(data, "renderer.sqlite3"),
        "wx",
        0o600,
      );
      await destination.close();
      const sourceDb = new DatabaseSync(database, { readOnly: true });
      try {
        sourceDb.exec("PRAGMA busy_timeout=30000");
        sourceDb.prepare("VACUUM INTO ?").run(join(data, "renderer.sqlite3"));
      } finally {
        sourceDb.close();
      }
      await chmod(join(data, "renderer.sqlite3"), 0o600);
      const databaseVersion = checkDatabase(join(data, "renderer.sqlite3"));
      await mkdir(join(data, "storage"), { mode: 0o700 });
      for (const relative of inventory.directories)
        await mkdir(join(data, "storage", relative), {
          recursive: true,
          mode: 0o700,
        });
      const records = [];
      for (const entry of inventory.files) {
        const input = join(storage, entry.path),
          output = join(data, "storage", entry.path);
        const before = await digest(input);
        if (before.bytes !== entry.bytes)
          throw new Error("Recovery storage changed after admission");
        await mkdir(resolve(output, ".."), { recursive: true, mode: 0o700 });
        await copyBounded(input, output, entry.bytes);
        const after = await digest(output);
        if (after.sha256 !== before.sha256 || after.bytes !== before.bytes)
          throw new Error("Recovery storage changed while copying");
        records.push({ path: `storage/${entry.path}`, ...after });
      }
      if (
        JSON.stringify(await tree(storage, this.policy.maxEntries)) !==
        JSON.stringify(inventory)
      )
        throw new Error("Recovery storage tree changed while copying");
      records.push({
        path: "renderer.sqlite3",
        ...(await digest(join(data, "renderer.sqlite3"))),
      });
      const manifest = {
        format: 1,
        id,
        createdAt: now,
        release,
        schema: databaseVersion.sqliteUserVersion, // legacy format-1 alias
        ...databaseVersion,
        storageIncluded: true,
        directories: inventory.directories,
        files: records,
      };
      await writeFile(join(data, "manifest.json"), JSON.stringify(manifest), {
        mode: 0o600,
      });
      const archive = join(work, "recovery.tar.age");
      await commandPipe(
        ["tar", "-C", data, "-cf", "-", "."],
        ["age", "-R", recipient, "-o", archive],
        single,
      );
      await chmod(archive, 0o600);
      await commandPipe(
        ["age", "-d", "-i", identity, archive],
        [
          "tar",
          // Consume authenticated producer EOF, not just tar's first zero
          // record. Early tar exit otherwise races Node's pipe completion.
          "--ignore-zeros",
          "--warning=alone-zero-block",
          "--warning=missing-zero-blocks",
          "--no-same-owner",
          "--no-same-permissions",
          "-C",
          verified,
          "-xf",
          "-",
        ],
        single,
      );
      for (const record of [
        ...records,
        {
          path: "manifest.json",
          ...(await digest(join(data, "manifest.json"))),
        },
      ]) {
        const actual = await digest(join(verified, record.path));
        if (actual.sha256 !== record.sha256 || actual.bytes !== record.bytes)
          throw new Error("Decrypted recovery verification failed");
      }
      if (
        JSON.stringify(checkDatabase(join(verified, "renderer.sqlite3"))) !==
        JSON.stringify(databaseVersion)
      )
        throw new Error("Decrypted recovery database version mismatch");
      const summary = {
        format: 1,
        id,
        createdAt: now,
        release,
        schema: databaseVersion.sqliteUserVersion, // legacy format-1 alias
        ...databaseVersion,
        storageIncluded: true,
        files: records.length,
        archive: await digest(archive),
      };
      if (summary.archive.bytes > single)
        throw new Error("Encrypted recovery point exceeds capacity estimate");
      const output = join(work, "point");
      await mkdir(output, { mode: 0o700 });
      await rename(archive, join(output, "recovery.tar.age"));
      await writeFile(join(output, "summary.json"), JSON.stringify(summary), {
        mode: 0o600,
      });
      for (const name of ["recovery.tar.age", "summary.json"]) {
        const file = await open(join(output, name), "r");
        try {
          await file.sync();
        } finally {
          await file.close();
        }
      }
      const pointDirectory = await open(output, "r");
      try {
        await pointDirectory.sync();
      } finally {
        await pointDirectory.close();
      }
      await rename(output, join(this.root, "points", id));
      const parent = await open(join(this.root, "points"), "r");
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
      return summary;
    } finally {
      await this.remove(work);
    }
  }
}
