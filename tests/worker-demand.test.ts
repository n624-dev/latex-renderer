import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { RendererDatabase } from "../packages/database/src/index.js";
import * as demand from "../deploy/scripts/worker-demand.mjs";
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
    notify = vi.fn(async () => true),
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
        socket.once("data", () => socket.end("ok")),
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
  "retains Unix notifications queued across process exit and rejects the wrong descriptor",
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
await new Promise(r=>setTimeout(r,150));await listener.close();"""
 def start(path):return subprocess.Popen([os.environ['TEST_NODE'],'--input-type=module','-e',script,path],pass_fds=(3,),stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 for i in range(3):
  c=socket.socket(socket.AF_UNIX);c.settimeout(5);c.connect(path);c.sendall(b'w')
  p=start(path);assert c.recv(2)==b'ok';c.close();p.wait(timeout=5);assert p.returncode==0,p.stderr.read()
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
