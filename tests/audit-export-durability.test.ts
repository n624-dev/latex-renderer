import { execFile, spawn } from "node:child_process";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { RendererDatabase } from "@latex-renderer/database";
import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readAuditCheckpoint } from "../deploy/scripts/audit-checkpoint.mjs";

const execute = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("exports late same-timestamp reverse IDs and backdated rows after a completed batch", async () => {
  const fixture = await createFixture();
  fixture.insert("audit_z", "2020-01-01T00:00:00.000Z");
  await fixture.export();
  fixture.insert("audit_a", "2020-01-01T00:00:00.000Z");
  fixture.insert("audit_backdated", "2019-01-01T00:00:00.000Z");
  const result = await fixture.export();
  expect(JSON.parse(result.stdout)).toMatchObject({ count: 2 });
  expect((await fixture.rows()).map((row) => row.id).sort()).toEqual([
    "audit_a",
    "audit_backdated",
    "audit_z",
  ]);
  expect(JSON.parse((await fixture.export()).stdout)).toMatchObject({
    count: 0,
  });
});

it("GC retains a late unexported row even when its time and ID precede the checkpoint", async () => {
  const f = await createFixture();
  f.insert("audit_z");
  await f.export();
  f.insert("audit_a");
  expect(JSON.parse((await f.cleanup()).stdout)).toMatchObject({
    auditLogsDeleted: 1,
  });
  expect(f.query("SELECT id FROM audit_logs")).toEqual([{ id: "audit_a" }]);
  expect(
    f.query(
      "SELECT sequence,audit_id FROM audit_export_sequence ORDER BY sequence",
    ),
  ).toEqual([
    { sequence: 1, audit_id: null },
    { sequence: 2, audit_id: "audit_a" },
  ]);
  expect(JSON.parse((await f.export()).stdout)).toMatchObject({ count: 1 });
  expect(JSON.parse((await f.cleanup()).stdout)).toMatchObject({
    auditLogsDeleted: 1,
    auditSequenceEntriesDeleted: 1,
  });
  expect(
    f.query("SELECT sequence,audit_id FROM audit_export_sequence"),
  ).toEqual([{ sequence: 2, audit_id: null }]);
  expect(JSON.parse((await f.export()).stdout)).toMatchObject({ count: 0 });
  f.insert("audit_new");
  expect(JSON.parse((await f.export()).stdout)).toMatchObject({ count: 1 });
  expect(await readAuditCheckpoint(f.checkpointPath)).toMatchObject({
    sequence: "3",
  });
});

it.each([1, 2])(
  "replays all surviving rows once from legacy format %i, and never prunes using it",
  async (format) => {
    const f = await createFixture();
    f.insert("audit_z");
    f.insert("audit_a");
    const createdAt = "2020-01-01T00:00:00.000Z",
      id = "audit_z";
    const legacy =
      format === 1
        ? { createdAt, id }
        : {
            format: 2,
            createdAt,
            id,
            sha256: createHash("sha256")
              .update(`${createdAt}\n${id}\n`)
              .digest("hex"),
          };
    await mkdir(join(f.root, "audit"));
    await writeFile(f.checkpointPath, JSON.stringify(legacy));
    expect(JSON.parse((await f.cleanup()).stdout)).toMatchObject({
      auditLogsDeleted: 0,
    });
    expect(JSON.parse((await f.export()).stdout)).toMatchObject({
      count: 2,
      legacyReplay: true,
    });
    expect(await readAuditCheckpoint(f.checkpointPath)).toMatchObject({
      format: 3,
      sequence: "2",
    });
    expect(JSON.parse((await f.export()).stdout)).toMatchObject({
      count: 0,
      legacyReplay: false,
    });
  },
);

it("migrates the legacy destination checkpoint and an empty database without repeated replay", async () => {
  const f = await createFixture();
  await mkdir(f.destination);
  await writeFile(
    join(f.destination, "audit-export.checkpoint"),
    JSON.stringify({ createdAt: "2020-01-01", id: "old" }),
  );
  expect(
    JSON.parse((await f.export({ AUDIT_EXPORT_CHECKPOINT: undefined })).stdout),
  ).toMatchObject({ count: 0, legacyReplay: true });
  expect(
    JSON.parse((await f.export({ AUDIT_EXPORT_CHECKPOINT: undefined })).stdout),
  ).toMatchObject({ count: 0, legacyReplay: false });
  expect(
    await readAuditCheckpoint(join(f.root, "audit", "export.checkpoint")),
  ).toMatchObject({ format: 3, sequence: "0" });
});

it.each([
  "broken-json",
  "wrong-db",
  "missing-ledger",
  "missing-trigger",
  "missing-identity",
])("fails export and audit GC closed on %s", async (damage) => {
  const f = await createFixture();
  f.insert("audit_z");
  await f.export();
  f.insert("audit_a");
  if (damage === "broken-json") await writeFile(f.checkpointPath, "broken");
  else
    f.sql(
      {
        "wrong-db":
          "UPDATE audit_export_state SET database_id=lower(hex(randomblob(32)))",
        "missing-ledger":
          "DELETE FROM audit_export_sequence WHERE audit_id='audit_a'",
        "missing-trigger": "DROP TRIGGER audit_export_insert",
        "missing-identity": "DELETE FROM audit_export_state",
      }[damage] ?? "",
    );
  await expect(f.export()).rejects.toThrow();
  expect(JSON.parse((await f.cleanup()).stdout)).toMatchObject({
    auditLogsDeleted: 0,
    result: "partial",
    itemFailureCount: 1,
  });
  expect(f.query("SELECT id FROM audit_logs ORDER BY id")).toEqual([
    { id: "audit_a" },
    { id: "audit_z" },
  ]);
});

it("rejects external checkpoints from before a restored branch even after its sequence catches up", async () => {
  const f = await createFixture();
  f.insert("audit_first");
  await f.export();
  const backup = join(f.root, "before-second.sqlite3");
  f.sql("PRAGMA wal_checkpoint(TRUNCATE)");
  await copyFile(f.databasePath, backup);
  f.insert("audit_second");
  await f.export();
  await copyFile(backup, f.databasePath);
  await expect(f.export()).rejects.toThrow("does not match this database");
  f.insert("audit_different_second");
  await expect(f.export()).rejects.toThrow(
    "anchor does not match this database",
  );
  expect(JSON.parse((await f.cleanup()).stdout)).toMatchObject({
    auditLogsDeleted: 0,
    result: "partial",
  });
});

it.each(["encrypt", "empty", "upload", "checkpoint"])(
  "never acknowledges a batch on %s failure and removes plaintext/partial files",
  async (failure) => {
    const f = await createFixture();
    f.insert("audit_pending");
    const uploader = join(f.bin, "uploader");
    await writeFile(uploader, "#!/usr/bin/env node\nprocess.exit(1);\n", {
      mode: 0o700,
    });
    await expect(
      f.export({
        TEST_AGE_FAILURE: failure,
        ...(failure === "upload" ? { BACKUP_UPLOAD_EXECUTABLE: uploader } : {}),
      }),
    ).rejects.toThrow();
    if (failure === "checkpoint") {
      await expect(readAuditCheckpoint(f.checkpointPath)).rejects.toThrow();
      await rm(f.checkpointPath, { recursive: true });
    } else
      expect(await readAuditCheckpoint(f.checkpointPath)).toEqual({
        format: 0,
      });
    expect(
      (await readdir(f.destination)).some(
        (name) => name.includes(".part-") || name.endsWith(".jsonl"),
      ),
    ).toBe(false);
    expect(await readdir(join(f.root, "tmp"))).toEqual([]);
    expect(JSON.parse((await f.cleanup()).stdout)).toMatchObject({
      auditLogsDeleted: 0,
    });
    expect(JSON.parse((await f.export()).stdout)).toMatchObject({ count: 1 });
  },
);

it("honors batch and invocation limits without acknowledging the remainder", async () => {
  const f = await createFixture();
  for (let index = 0; index < 5; index += 1) f.insert(`audit_${index}`);
  expect(
    JSON.parse((await f.export({ AUDIT_EXPORT_MAX_BATCHES: "1" })).stdout),
  ).toMatchObject({ count: 2, batches: 1, backlogMayRemain: true });
  expect(await readAuditCheckpoint(f.checkpointPath)).toMatchObject({
    sequence: "2",
  });
  expect(JSON.parse((await f.cleanup()).stdout)).toMatchObject({
    auditLogsDeleted: 2,
  });
  expect(f.query("SELECT count(*) AS count FROM audit_logs")).toEqual([
    { count: 3 },
  ]);
  expect(JSON.parse((await f.export()).stdout)).toMatchObject({
    count: 3,
    batches: 2,
  });
});

it.each(["encrypted-file", "archive-directory", "checkpoint-file"])(
  "does not acknowledge on %s fsync failure",
  async (failure) => {
    const f = await createFixture();
    f.insert("audit_pending");
    const hook = join(f.root, "sync-failure.mjs");
    await writeFile(
      hook,
      `import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
const original = fs.open;
fs.open = async function(path, ...args) {
  const handle = await original.call(this, path, ...args);
  if ((process.env.TEST_SYNC_FAILURE === "encrypted-file" && String(path).includes(".part-")) ||
    (process.env.TEST_SYNC_FAILURE === "archive-directory" && String(path) === process.env.BACKUP_DIRECTORY) ||
    (process.env.TEST_SYNC_FAILURE === "checkpoint-file" && String(path).includes("checkpoint.tmp-")))
    handle.sync = async () => { throw new Error("injected fsync failure"); };
  return handle;
};
syncBuiltinESMExports();
`,
    );
    await expect(
      f.export({
        NODE_OPTIONS: `--import=${pathToFileURL(hook).href}`,
        TEST_SYNC_FAILURE: failure,
      }),
    ).rejects.toThrow("injected fsync failure");
    expect(await readAuditCheckpoint(f.checkpointPath)).toEqual({ format: 0 });
    expect(
      (await readdir(f.destination)).some((name) => name.includes(".part-")),
    ).toBe(false);
    expect(
      (await readdir(join(f.root, "audit"))).some((name) =>
        name.includes(".tmp-"),
      ),
    ).toBe(false);
    expect(await readdir(join(f.root, "tmp"))).toEqual([]);
    expect(JSON.parse((await f.cleanup()).stdout)).toMatchObject({
      auditLogsDeleted: 0,
    });
    expect(JSON.parse((await f.export()).stdout)).toMatchObject({ count: 1 });
  },
);

it("rejects concurrent exporters even when a different checkpoint path is supplied", async () => {
  const f = await createFixture();
  f.insert("audit_one");
  const marker = join(f.root, "age-started");
  const running = spawn(
    process.execPath,
    [join(process.cwd(), "deploy/scripts/audit-export.mjs")],
    {
      env: { ...f.env, TEST_AGE_WAIT_MARKER: marker },
      stdio: "ignore",
    },
  );
  const completion = new Promise<number | null>((resolve, reject) => {
    running.once("error", reject);
    running.once("close", resolve);
  });
  try {
    await expect
      .poll(async () => readFile(marker, "utf8").catch(() => ""), {
        timeout: 5000,
      })
      .toBe("ready");
    await expect(
      f.export({ AUDIT_EXPORT_CHECKPOINT: join(f.root, "other.checkpoint") }),
    ).rejects.toThrow("flock failed");
    await writeFile(`${marker}.release`, "continue");
    expect(await completion).toBe(0);
  } finally {
    if (running.exitCode === null) {
      running.kill("SIGKILL");
      await completion;
    }
  }
  expect(JSON.parse((await f.export()).stdout)).toMatchObject({ count: 0 });
});

it("allows writers and audit GC during encryption without acknowledging an unfinished batch", async () => {
  const f = await createFixture();
  f.insert("audit_old");
  await f.export();
  f.insert("audit_pending");
  const marker = join(f.root, "gc-during-encryption");
  const running = spawn(
    process.execPath,
    [join(process.cwd(), "deploy/scripts/audit-export.mjs")],
    {
      env: { ...f.env, TEST_AGE_WAIT_MARKER: marker },
      stdio: "ignore",
    },
  );
  const completion = new Promise<number | null>((resolve, reject) => {
    running.once("error", reject);
    running.once("close", resolve);
  });
  try {
    await expect
      .poll(async () => readFile(marker, "utf8").catch(() => ""), {
        timeout: 5000,
      })
      .toBe("ready");
    f.insert("audit_late_during_encryption", "2019-01-01T00:00:00.000Z");
    expect(await readAuditCheckpoint(f.checkpointPath)).toMatchObject({
      sequence: "1",
    });
    expect(JSON.parse((await f.cleanup()).stdout)).toMatchObject({
      auditLogsDeleted: 1,
    });
    expect(f.query("SELECT id FROM audit_logs ORDER BY id")).toEqual([
      { id: "audit_late_during_encryption" },
      { id: "audit_pending" },
    ]);
    await writeFile(`${marker}.release`, "continue");
    expect(await completion).toBe(0);
  } finally {
    await writeFile(`${marker}.release`, "continue");
    if (running.exitCode === null) {
      running.kill("SIGKILL");
      await completion;
    }
  }
  expect(JSON.parse((await f.export()).stdout)).toMatchObject({ count: 1 });
  expect((await f.rows()).map((row) => row.id).sort()).toEqual([
    "audit_late_during_encryption",
    "audit_old",
    "audit_pending",
  ]);
});

it("produces real age ciphertext that decrypts to complete sequenced audit rows", async () => {
  const f = await createFixture();
  f.insert("audit_real_crypto");
  const identity = join(f.root, "identity"),
    recipient = join(f.root, "recipient");
  await execute("age-keygen", ["-o", identity]);
  const publicKey = await execute("age-keygen", ["-y", identity]);
  await writeFile(recipient, publicKey.stdout, { mode: 0o600 });
  await f.export({
    PATH: process.env.PATH,
    BACKUP_AGE_RECIPIENT_FILE: recipient,
  });
  const files = (await readdir(f.destination)).filter((name) =>
    name.endsWith(".age"),
  );
  expect(files).toHaveLength(1);
  const clear = await execute("age", [
    "-d",
    "-i",
    identity,
    join(f.destination, files[0] ?? "missing"),
  ]);
  expect(JSON.parse(clear.stdout)).toMatchObject({
    id: "audit_real_crypto",
    export_sequence: "1",
  });
  expect(await readdir(join(f.root, "tmp"))).toEqual([]);
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "audit-durability-"));
  roots.push(root);
  const databasePath = join(root, "renderer.sqlite3"),
    destination = join(root, "backups"),
    checkpointPath = join(root, "audit", "checkpoint"),
    bin = join(root, "bin");
  await mkdir(bin);
  await mkdir(join(root, "tmp"));
  await writeFile(
    join(bin, "age"),
    `#!/usr/bin/env node
const { copyFileSync, existsSync, mkdirSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
if (process.env.TEST_AGE_WAIT_MARKER) {
  writeFileSync(process.env.TEST_AGE_WAIT_MARKER, "ready");
  const deadline = Date.now() + 10000;
  while (!existsSync(process.env.TEST_AGE_WAIT_MARKER + ".release")) {
    if (Date.now() > deadline) process.exit(1);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
}
if (process.env.TEST_AGE_FAILURE === "encrypt") { writeFileSync(args[args.indexOf("-o") + 1], "partial"); process.exit(1); }
if (process.env.TEST_AGE_FAILURE === "empty") { writeFileSync(args[args.indexOf("-o") + 1], ""); process.exit(0); }
copyFileSync(args.at(-1), args[args.indexOf("-o") + 1]);
if (process.env.TEST_AGE_FAILURE === "checkpoint") mkdirSync(process.env.AUDIT_EXPORT_CHECKPOINT);
`,
    { mode: 0o700 },
  );
  const database = new RendererDatabase(databasePath);
  database.migrate();
  database.close();
  const env = {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    DATABASE_PATH: databasePath,
    STORAGE_ROOT: join(root, "storage"),
    BACKUP_DIRECTORY: destination,
    BACKUP_AGE_RECIPIENT_FILE: join(root, "recipient"),
    AUDIT_EXPORT_CHECKPOINT: checkpointPath,
    AUDIT_EXPORT_BATCH_SIZE: "2",
    AUDIT_EXPORT_MAX_BATCHES: "10",
    TMPDIR: join(root, "tmp"),
  };
  return {
    root,
    databasePath,
    destination,
    checkpointPath,
    bin,
    env,
    sql(sql: string) {
      const db = new RendererDatabase(databasePath);
      try {
        db.raw.exec(sql);
      } finally {
        db.close();
      }
    },
    query(sql: string) {
      const db = new RendererDatabase(databasePath);
      try {
        return db.raw.prepare(sql).all();
      } finally {
        db.close();
      }
    },
    insert(id: string, timestamp = "2020-01-01T00:00:00.000Z") {
      const db = new RendererDatabase(databasePath);
      try {
        db.raw
          .prepare(
            `INSERT INTO audit_logs(id,actor_type,actor_id,action,target_type,target_id,result,metadata_json,created_at)
          VALUES (?,'system','test','test.action','test','test','success','{}',?)`,
          )
          .run(id, timestamp);
      } finally {
        db.close();
      }
    },
    export(overrides: NodeJS.ProcessEnv = {}) {
      return execute(
        process.execPath,
        [join(process.cwd(), "deploy/scripts/audit-export.mjs")],
        { env: { ...env, ...overrides } },
      );
    },
    cleanup() {
      return execute(
        process.execPath,
        [join(process.cwd(), "deploy/scripts/cleanup.mjs")],
        { env },
      );
    },
    async rows(): Promise<{ id: string }[]> {
      const files = (await readdir(destination)).filter((name) =>
        name.endsWith(".age"),
      );
      return (
        await Promise.all(
          files.map(async (name) =>
            (await readFile(join(destination, name), "utf8"))
              .trim()
              .split("\n")
              .map((line) => JSON.parse(line) as { id: string }),
          ),
        )
      ).flat();
    },
  };
}
