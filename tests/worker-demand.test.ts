import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";
import { setTimeout } from "node:timers";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { RendererDatabase } from "../packages/database/src/index.js";
import * as demand from "../deploy/scripts/worker-demand.mjs";
import { readWorkerHealth } from "../deploy/scripts/worker-health.mjs";
import {
  reconcileWorker,
  workerMaintenanceDue,
} from "../deploy/scripts/reconcile-worker.mjs";

const roots: string[] = [],
  databases: DatabaseSync[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0))
    rmSync(root, { force: true, recursive: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "worker-demand-"));
  roots.push(root);
  const path = join(root, "queue.sqlite3");
  const database = new DatabaseSync(path);
  databases.push(database);
  database.exec(`CREATE TABLE jobs(status TEXT, lease_owner TEXT);
    CREATE TABLE job_preview_requests(status TEXT,lease_owner TEXT);
    CREATE TABLE source_tree_readers(id TEXT);
    CREATE TABLE source_trees(status TEXT);
    CREATE TABLE system_settings(key TEXT PRIMARY KEY,value_json TEXT);`);
  return { root, path, database };
}

it("requires explicit opt-in and bounds the idle deadline", () => {
  expect(demand.workerIdleConfiguration({})).toEqual({
    enabled: false,
    timeoutMs: 900000,
  });
  expect(
    demand.workerIdleConfiguration({
      WORKER_IDLE_ENABLED: "true",
      WORKER_IDLE_TIMEOUT_SECONDS: "30",
    }),
  ).toEqual({ enabled: true, timeoutMs: 30000 });
  for (const value of ["0", "29", "86401", "1.5", "Infinity", " 900"])
    expect(() =>
      demand.workerIdleConfiguration({ WORKER_IDLE_TIMEOUT_SECONDS: value }),
    ).toThrow();
  expect(() =>
    demand.workerIdleConfiguration({ WORKER_IDLE_ENABLED: "yes" }),
  ).toThrow();
});

it.each([
  "INSERT INTO jobs VALUES ('queued',NULL)",
  "INSERT INTO jobs VALUES ('validating','owner')",
  "INSERT INTO jobs VALUES ('running','owner')",
  "INSERT INTO jobs VALUES ('canceled','owner:recovery:1')",
  "INSERT INTO jobs VALUES ('failed','cleanup-owner')",
  "INSERT INTO job_preview_requests VALUES ('queued',NULL)",
  "INSERT INTO job_preview_requests VALUES ('running','owner')",
  "INSERT INTO job_preview_requests VALUES ('failed','cleanup-owner')",
  "INSERT INTO source_tree_readers VALUES ('reader')",
  "INSERT INTO source_trees VALUES ('building')",
  "INSERT INTO source_trees VALUES ('deleting')",
])("keeps pending work or cleanup awake: %s", (insert) => {
  const f = fixture();
  expect(demand.workerHasDemand(f.database)).toBe(false);
  f.database.exec(insert);
  expect(demand.workerHasDemand(f.database)).toBe(true);
});

it("allows terminal Jobs and completed previews to sleep", () => {
  const f = fixture();
  f.database.exec(
    "INSERT INTO jobs VALUES ('succeeded',NULL),('failed',NULL),('canceled',NULL); INSERT INTO job_preview_requests VALUES ('succeeded',NULL),('failed',NULL); INSERT INTO source_trees VALUES ('ready'),('invalid')",
  );
  expect(demand.workerHasDemand(f.database)).toBe(false);
});

it("treats a stopping Worker as unavailable in the direct health reader", () => {
  const { root, path: databasePath } = fixture();
  const path = join(root, "health.json"),
    now = Date.now();
  const run = () => "ActiveState=active\nMainPID=1234\n";
  for (const [stopping, state] of [
    [false, "running"],
    [true, "unavailable"],
  ] as const) {
    writeFileSync(
      path,
      JSON.stringify({
        pid: 1234,
        at: new Date(now).toISOString(),
        mode: "running",
        stopping,
      }),
      { mode: 0o600 },
    );
    expect(readWorkerHealth({ path, now, databasePath, run })).toEqual({
      operational: !stopping,
      state,
    });
  }
});

it("reports a listening Worker as idle while cleanup is the only demand", () => {
  const { root, path: databasePath, database } = fixture();
  const path = join(root, "health.json");
  const run = (...args: string[]) =>
    args.at(-1)?.endsWith(".socket")
      ? "LoadState=loaded\nActiveState=active\nSubState=listening\n"
      : "LoadState=loaded\nActiveState=inactive\nResult=success\n";
  database.exec(`INSERT INTO source_trees VALUES ('deleting');
    INSERT INTO system_settings VALUES ('maintenance_mode','"reject-new-jobs"');`);
  expect(demand.workerHasDemand(database)).toBe(true);
  expect(readWorkerHealth({ path, databasePath, run })).toEqual({
    operational: true, state: "idle",
  });
  database.exec("INSERT INTO jobs VALUES ('queued',NULL)");
  expect(readWorkerHealth({ path, databasePath, run })).toEqual({
    operational: false, state: "unavailable",
  });
});

it("distinguishes pending PDF work from expired maintenance records", () => {
  const { database } = fixture();
  const now = "2026-11-27T00:00:00.000Z";
  database.exec(`CREATE TABLE pdf_inspections(status TEXT,expires_at TEXT);
    CREATE TABLE document_probes(status TEXT,expires_at TEXT);
    CREATE TABLE pdf_inspection_uploads(expires_at TEXT);
    INSERT INTO pdf_inspections VALUES('queued','2026-11-26T23:59:00.000Z');
    INSERT INTO document_probes VALUES('queued','2026-11-26T23:59:00.000Z');
    INSERT INTO pdf_inspection_uploads VALUES('2026-11-26T23:59:00.000Z');`);
  expect(demand.workerHasDemand(database, { now })).toBe(true);
  expect(
    demand.workerHasDemand(database, { now, includeMaintenance: false }),
  ).toBe(false);
  for (const table of ["pdf_inspections", "document_probes"]) {
    database.exec(`UPDATE ${table} SET status='running'`);
    expect(
      demand.workerHasDemand(database, { now, includeMaintenance: false }),
    ).toBe(true);
    database.exec(`UPDATE ${table} SET status='queued'`);
  }
  database.exec(
    "UPDATE document_probes SET expires_at='2026-11-27T00:01:00.000Z'",
  );
  expect(
    demand.workerHasDemand(database, { now, includeMaintenance: false }),
  ).toBe(true);
});

it("notifies after commit, observes committed state, and never notifies on rollback", () => {
  const db = new RendererDatabase(":memory:");
  const observed: unknown[] = [];
  const notify = vi
    .spyOn(demand, "notifyWorkerAfterCommit")
    .mockImplementation((raw) => {
      observed.push(raw.prepare("SELECT value FROM fixture").get()?.value);
    });
  try {
    db.raw.exec("CREATE TABLE fixture(value TEXT)");
    db.transaction(() => {
      db.raw.exec("INSERT INTO fixture VALUES ('committed')");
      expect(notify).not.toHaveBeenCalled();
    });
    expect(observed).toEqual(["committed"]);
    expect(() =>
      db.transaction(() => {
        db.raw.exec("DELETE FROM fixture");
        throw new Error("rollback");
      }),
    ).toThrow("rollback");
    expect(notify).toHaveBeenCalledOnce();
    expect(db.raw.prepare("SELECT value FROM fixture").get()?.value).toBe(
      "committed",
    );
  } finally {
    db.close();
  }
});

it("reconciles lost notifications and maintenance without starting stopped listeners", async () => {
  const f = fixture(),
    notify = vi.fn(() => Promise.resolve(true)),
    run = vi.fn(() => "ActiveState=active\nSubState=listening\n");
  const environment = { WORKER_IDLE_ENABLED: "true", DATABASE_PATH: f.path };
  expect(await reconcileWorker({ environment, notify, run })).toMatchObject({
    state: "notified",
    maintenance: true,
  });
  f.database
    .prepare("INSERT INTO system_settings VALUES ('worker_maintenance',?)")
    .run(JSON.stringify({ completedAt: new Date().toISOString() }));
  expect(await reconcileWorker({ environment, notify, run })).toEqual({
    state: "idle",
  });
  f.database.exec("INSERT INTO jobs VALUES ('queued',NULL)");
  expect(await reconcileWorker({ environment, notify, run })).toMatchObject({
    state: "notified",
    demand: true,
  });
  notify.mockClear();
  run.mockReturnValue("ActiveState=inactive\nSubState=dead\n");
  expect(await reconcileWorker({ environment, notify, run })).toEqual({
    state: "suspended",
    demand: true,
  });
  expect(notify).not.toHaveBeenCalled();
  run.mockReturnValue("ActiveState=active\nSubState=listening\n");
  notify.mockResolvedValue(false);
  await expect(reconcileWorker({ environment, notify, run })).rejects.toThrow(
    "notification",
  );
  f.database.exec("UPDATE system_settings SET value_json='broken'");
  await expect(reconcileWorker({ environment, notify, run })).rejects.toThrow();
});

it("rejects corrupt or future maintenance state rather than discarding recovery work", () => {
  const f = fixture();
  f.database
    .prepare("INSERT INTO system_settings VALUES ('worker_maintenance',?)")
    .run(JSON.stringify({ completedAt: "invalid" }));
  expect(() => workerMaintenanceDue(f.database)).toThrow();
  f.database.prepare("UPDATE system_settings SET value_json=?").run(
    JSON.stringify({
      completedAt: new Date(Date.now() + 60000).toISOString(),
    }),
  );
  expect(() => workerMaintenanceDue(f.database)).toThrow();
});

it.skipIf(process.platform === "win32")(
  "bounds notification latency and requires acknowledgement",
  async () => {
    const f = fixture(),
      path = join(f.root, "wake.sock"),
      server = createServer((socket) =>
        socket.once("data", () => {
          socket.write("o");
          setTimeout(() => socket.end("k"), 10);
        }),
      );
    await new Promise<void>((resolve) => server.listen(path, resolve));
    try {
      expect(await demand.notifyWorker({ path, timeoutMs: 100 })).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    expect(await demand.notifyWorker({ path, timeoutMs: 100 })).toBe(false);
    const silent = createServer((socket) => {
      socket.on("data", () => {});
      socket.on("end", () => socket.end());
    });
    await new Promise<void>((resolve) => silent.listen(path, resolve));
    try {
      expect(await demand.notifyWorker({ path, timeoutMs: 50 })).toBe(false);
    } finally {
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  },
);

it.skipIf(process.platform === "win32")(
  "drains queued maintenance hints before immediate exit and rejects the wrong descriptor",
  () => {
    execFileSync(
      "python3",
      [
        "-c",
        String.raw`
import os,socket,subprocess,tempfile
with tempfile.TemporaryDirectory(prefix='worker-wake-') as root:
 path=root+'/wake.sock';s=socket.socket(socket.AF_UNIX);assert s.fileno()==3;s.bind(path);s.listen(128)
 script="""import {workerWakeListener} from './deploy/scripts/worker-demand.mjs';
process.env.LISTEN_PID=String(process.pid);process.env.LISTEN_FDS='1';process.env.LISTEN_FDNAMES='worker';
const listener=await workerWakeListener(process.env,{path:process.argv[1]});
if(listener.drain)await listener.drain();await listener.close();"""
 def start(path):return subprocess.Popen([os.environ['TEST_NODE'],'--input-type=module','-e',script,path],pass_fds=(3,),stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 for i in range(3):
  clients=[]
  for j in range(16):
   c=socket.socket(socket.AF_UNIX);c.settimeout(3);c.connect(path);c.sendall(b'w');clients.append(c)
  for j in range(8):
   c=socket.socket(socket.AF_UNIX);c.connect(path);c.sendall(b'w');c.close()
  p=start(path)
  try:
   for j,c in enumerate(clients):
    assert c.recv(2)==b'ok'
    if i!=0 or j!=0:c.close()
   p.wait(timeout=5);assert p.returncode==0,p.stderr.read()
   import select
   assert not select.select([s],[],[],0)[0], 'Queued hints would reactivate an empty Worker'
  finally:
   for c in clients:c.close()
   if p.poll() is None:p.kill();p.wait(timeout=5)
 p=start(path+'-wrong');p.wait(timeout=5);assert p.returncode!=0
 s.close()
`,
      ],
      {
        timeout: 15000,
        stdio: "pipe",
        env: { ...process.env, TEST_NODE: process.execPath },
      },
    );
  },
);
