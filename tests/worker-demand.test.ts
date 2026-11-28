import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";
import { setTimeout } from "node:timers";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { RendererDatabase } from "../packages/database/src/index.js";
import * as demand from "../deploy/scripts/worker-demand.mjs";
import { readWorkerHealth } from "../deploy/scripts/worker-health.mjs";
import { claimAuxiliaryWork } from "../apps/renderer-worker/src/auxiliary-work.js";
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
    operational: true,
    state: "idle",
  });
  database.exec("INSERT INTO jobs VALUES ('queued',NULL)");
  expect(readWorkerHealth({ path, databasePath, run })).toEqual({
    operational: false,
    state: "unavailable",
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

const parityTime = "2026-11-27T00:00:00.000Z";
const before = "2026-11-26T23:59:59.999Z";
const after = "2026-11-27T00:00:00.001Z";
const active = { ActiveState: "active", MainPID: "1234" };
const listening = { ActiveState: "active", SubState: "listening" };
const fresh = { pid: 1234, at: parityTime, mode: "running", stopping: false };

function healthReaders(
  f: ReturnType<typeof fixture>,
  {
    heartbeat = fresh,
    service = { ActiveState: "inactive", MainPID: "0" },
    socket = listening,
    checkDemand = false,
    databasePath = f.path,
  } = {},
) {
  const states = {
    "latex-renderer-api.service": {
      LoadState: "loaded",
      Result: "success",
      ActiveState: "active",
    },
    "latex-renderer-api.socket": listening,
    "latex-renderer-worker.service": {
      LoadState: "loaded",
      Result: "success",
      ...service,
    },
    "latex-renderer-worker.socket": socket,
  };
  const path = join(f.root, "health.json");
  writeFileSync(path, JSON.stringify(heartbeat), { mode: 0o600 });
  const run = vi.fn((...args: string[]) => {
    const name = args.at(-1) as keyof typeof states;
    return Object.entries(states[name])
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
  });
  const node = readWorkerHealth({
    path,
    databasePath,
    now: Date.parse(parityTime),
    run,
  });
  expect(run.mock.calls.every(([verb]) => verb === "show")).toBe(true);
  const outputPath = join(f.root, "python-health.json");
  const descriptor = openSync(outputPath, "w");
  try {
    execFileSync(
      "python3",
      [
        "-B",
        "-c",
        String.raw`
import importlib.util, io, json, os, sqlite3, sys
spec = importlib.util.spec_from_file_location('passive_health', 'deploy/scripts/passive-health.py')
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)
path, now, states, heartbeat, check_demand = json.loads(sys.argv[1])
os.environ['DEPLOYMENT_MODE'] = 'cloudflare'
class Clock(health.datetime.datetime):
    @classmethod
    def now(cls, tz=None):
        return cls.fromisoformat(now)
health.datetime.datetime = Clock
snapshot = health.snapshot(path, lambda: states, lambda: heartbeat)
result = dict(state=snapshot['worker'], operational=snapshot['rendering'])
class Connection:
    def __init__(self, path):
        self.request = io.BytesIO(f'GET {path} HTTP/1.1\r\n\r\n'.encode('ascii'))
    def settimeout(self, timeout):
        pass
    def makefile(self, mode):
        return self.request
    def sendall(self, data):
        self.status = int(data.split(b' ', 2)[1])
result['http'] = []
for endpoint in ('/health', '/api/v1/health', '/health/status', '/health/rendering'):
    connection = Connection(endpoint)
    health.respond(connection, lambda: snapshot)
    result['http'].append(connection.status)
if check_demand:
    db = sqlite3.connect('file:' + path + '?mode=ro', uri=True)
    try:
        result['demand'] = [health.worker_has_demand(db, now, flag) for flag in (True, False)]
    finally:
        db.close()
print(json.dumps(result))
`,
        JSON.stringify([
          databasePath,
          parityTime,
          states,
          heartbeat,
          checkDemand,
        ]),
      ],
      { stdio: ["ignore", descriptor, "inherit"], timeout: 5000 },
    );
  } finally {
    closeSync(descriptor);
  }
  const {
    demand: pythonDemand,
    http,
    ...python
  } = JSON.parse(readFileSync(outputPath, "utf8")) as {
    demand?: [boolean, boolean];
    http: number[];
    state: string;
    operational: boolean;
  };
  return { node, python, pythonDemand, http };
}

const demandCases = [
  { name: "empty", sql: "", interactive: false },
  {
    name: "queued Job",
    sql: "INSERT INTO jobs VALUES ('queued',NULL)",
    interactive: true,
  },
  {
    name: "validating Job",
    sql: "INSERT INTO jobs VALUES ('validating','owner')",
    interactive: true,
  },
  {
    name: "running Job",
    sql: "INSERT INTO jobs VALUES ('running','owner')",
    interactive: true,
  },
  {
    name: "queued Preview",
    sql: "INSERT INTO job_preview_requests VALUES ('queued',NULL)",
    interactive: true,
  },
  {
    name: "running Preview",
    sql: "INSERT INTO job_preview_requests VALUES ('running','owner')",
    interactive: true,
  },
  ...["pdf_inspections", "document_probes"].flatMap((table) => [
    {
      name: `queued ${table}`,
      sql: `INSERT INTO ${table} VALUES ('queued','${after}')`,
      interactive: true,
    },
    {
      name: `expired ${table}`,
      sql: `INSERT INTO ${table} VALUES ('queued','${parityTime}')`,
      interactive: false,
    },
    {
      name: `running ${table} after expiry`,
      sql: `INSERT INTO ${table} VALUES ('running','${before}')`,
      interactive: true,
    },
  ]),
  {
    name: "unexpired upload",
    sql: `INSERT INTO pdf_inspection_uploads VALUES ('${after}')`,
    interactive: false,
  },
  {
    name: "expired upload",
    sql: `INSERT INTO pdf_inspection_uploads VALUES ('${parityTime}')`,
    interactive: false,
    maintenance: true,
  },
  {
    name: "Job cleanup lease",
    sql: "INSERT INTO jobs VALUES ('canceled','recovery')",
    interactive: false,
    maintenance: true,
  },
  {
    name: "Preview cleanup lease",
    sql: "INSERT INTO job_preview_requests VALUES ('failed','recovery')",
    interactive: false,
    maintenance: true,
  },
  {
    name: "Source Tree reader",
    sql: "INSERT INTO source_tree_readers VALUES ('reader')",
    interactive: false,
    maintenance: true,
  },
  ...["building", "deleting"].map((status) => ({
    name: `${status} Source Tree`,
    sql: `INSERT INTO source_trees VALUES ('${status}')`,
    interactive: false,
    maintenance: true,
  })),
];

it.each(demandCases)(
  "shares the same SQLite demand semantics for $name",
  ({ sql, interactive, ...entry }) => {
    const f = fixture();
    f.database.exec(`CREATE TABLE pdf_inspections(status TEXT,expires_at TEXT);
    CREATE TABLE document_probes(status TEXT,expires_at TEXT);
    CREATE TABLE pdf_inspection_uploads(expires_at TEXT); ${sql}`);
    const { node, python, pythonDemand, http } = healthReaders(f, {
      checkDemand: true,
    });
    const expected = [
      interactive || ("maintenance" in entry && entry.maintenance),
      interactive,
    ];
    expect(
      [true, false].map((includeMaintenance) =>
        demand.workerHasDemand(f.database, {
          includeMaintenance,
          now: parityTime,
        }),
      ),
    ).toEqual(expected);
    expect(pythonDemand).toEqual(expected);
    const health = {
      operational: !interactive,
      state: interactive ? "unavailable" : "idle",
    };
    expect([node, python]).toEqual([health, health]);
    expect(http).toEqual([200, 200, 200, interactive ? 503 : 200]);
  },
);

it("requires a standalone interactive-demand fixture for each queue dispatched by the Worker", () => {
  const queues = [
    ...claimAuxiliaryWork.toString().matchAll(/\bFROM\s+(\w+)/gi),
  ].map(([, table]) => table);
  expect(queues).toContain("job_preview_requests");
  for (const queue of queues)
    expect(
      demandCases.some(
        ({ sql, interactive }) =>
          interactive && sql.startsWith(`INSERT INTO ${queue} `),
      ),
    ).toBe(true);
});

it.each([
  { name: "listening on the old schema", state: "idle" },
  { name: "fresh running", service: active, state: "running" },
  { name: "idle paused", mode: "paused", state: "paused" },
  {
    name: "running draining",
    mode: "draining",
    service: active,
    heartbeat: { ...fresh, mode: "draining" },
    state: "draining",
  },
  {
    name: "stopped",
    socket: { ActiveState: "inactive", SubState: "dead" },
    state: "unavailable",
  },
  {
    name: "starting",
    service: { ...active, ActiveState: "activating" },
    state: "unavailable",
  },
  {
    name: "stale heartbeat",
    service: active,
    heartbeat: { ...fresh, at: "2026-11-26T23:59:29.999Z" },
    state: "unavailable",
  },
  {
    name: "future heartbeat",
    service: active,
    heartbeat: { ...fresh, at: after },
    state: "unavailable",
  },
  {
    name: "PID mismatch",
    service: active,
    heartbeat: { ...fresh, pid: 4321 },
    state: "unavailable",
  },
  {
    name: "stopping heartbeat",
    service: active,
    heartbeat: { ...fresh, stopping: true },
    state: "unavailable",
  },
  { name: "locked DB", fault: "lock", state: "unavailable" },
  { name: "corrupt DB", fault: "corrupt", state: "unavailable" },
  { name: "missing DB", fault: "missing", state: "unavailable" },
])(
  "shares health semantics for $name",
  ({ mode, state, fault, ...options }) => {
    const f = fixture();
    if (mode)
      f.database
        .prepare("INSERT INTO system_settings VALUES ('worker_mode',?)")
        .run(JSON.stringify(mode));
    if (fault === "lock") f.database.exec("BEGIN EXCLUSIVE");
    const databasePath =
      fault === "missing" || fault === "corrupt" ? join(f.root, fault) : f.path;
    if (fault === "corrupt")
      writeFileSync(databasePath, "not a SQLite database");
    const { node, python, http } = healthReaders(f, {
      databasePath,
      ...options,
    });
    const expected = {
      state,
      operational: state === "idle" || state === "running",
    };
    expect([node, python]).toEqual([expected, expected]);
    expect(http).toEqual([200, 200, 200, expected.operational ? 200 : 503]);
  },
);

// The direct reader trusts the heartbeat mode, while passive health reads worker_mode from SQLite.
it.fails(
  "agrees on the configured pause while the last heartbeat still says running",
  () => {
    const f = fixture();
    f.database.exec(
      `INSERT INTO system_settings VALUES ('worker_mode','"paused"')`,
    );
    const { node, python } = healthReaders(f, { service: active });
    expect(python).toEqual({ state: "paused", operational: false });
    expect(node).toEqual(python);
  },
);

// The direct reader skips the database on its healthy running path.
it.fails(
  "agrees on unavailable health when the database is corrupt during a fresh heartbeat",
  () => {
    const f = fixture();
    const databasePath = join(f.root, "corrupt");
    writeFileSync(databasePath, "not a SQLite database");
    const { node, python } = healthReaders(f, {
      service: active,
      databasePath,
    });
    expect(python).toEqual({ state: "unavailable", operational: false });
    expect(node).toEqual(python);
  },
);

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
