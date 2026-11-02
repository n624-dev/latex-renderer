// Disposable Linux runner only. Own temporary units/listeners; no application
// DB, credentials, network downloads, containers, or production configuration.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer, connect } from "node:net";
import { request } from "node:http";
import {
  mkdtempSync,
  mkdirSync,
  chmodSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  rmSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import {
  controlService,
  httpServiceStatus,
  prepareHttpActivation,
} from "../scripts/http-services.mjs";

assert.equal(process.getuid(), 0);
assert.equal(process.platform, "linux");
const unit = "latex-renderer-api.service",
  socket = "latex-renderer-api.socket";
const run = (...args) =>
  execFileSync("/usr/bin/systemctl", args, {
    encoding: "utf8",
    timeout: 20000,
    stdio: ["ignore", "pipe", "pipe"],
  });
assert.match(run("show", "-p", "LoadState", "--value", unit), /not-found/);
assert.match(run("show", "-p", "LoadState", "--value", socket), /not-found/);
const user = process.env.SUDO_USER;
assert.match(user ?? "", /^[a-z_][a-z0-9_-]*$/);
const node = process.execPath,
  fixture = resolve("deploy/ci/http-idle-fixture.mjs");
for (const path of [node, fixture]) assert.match(path, /^\/[A-Za-z0-9_./-]+$/);
const root = mkdtempSync("/run/latex-http-idle-ci-");
chmodSync(root, 0o755);
const reserve = createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const paths = [unit, socket].map((name) => join("/run/systemd/system", name));
for (const path of paths) assert(!existsSync(path));
let created = false;
const state = () => httpServiceStatus(unit, { run });
const property = (name) => run("show", "-p", name, "--value", unit).trim();
const until = async (predicate, seconds = 8) => {
  const end = Date.now() + seconds * 1000;
  while (!predicate()) {
    assert(Date.now() < end, "systemd state transition timed out");
    await delay(40);
  }
};
const get = (path = "/") =>
  new Promise((resolve, reject) => {
    const start = performance.now();
    const req = request(
      { host: "127.0.0.1", port, path, agent: false, timeout: 10000 },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.once("end", () => {
          if (res.statusCode !== 200)
            reject(new Error("Unexpected fixture response"));
          else
            resolve({
              body: Buffer.concat(chunks).toString(),
              milliseconds: performance.now() - start,
            });
        });
        res.once("error", reject);
      },
    );
    req.once("timeout", () =>
      req.destroy(new Error("Fixture request timed out")),
    );
    req.once("error", reject);
    req.end();
  });
const results = { architecture: process.arch, checks: [] };
try {
  writeFileSync(
    paths[0],
    `[Unit]\nStartLimitIntervalSec=0\n[Service]\nType=notify\nNotifyAccess=all\nUser=${user}\nExecStart=${node} ${fixture} ${port} systemd 400\nTimeoutStartSec=10\nPrivateTmp=true\nNoNewPrivileges=true\n`,
    { flag: "wx", mode: 0o644 },
  );
  created = true;
  writeFileSync(
    paths[1],
    `[Socket]\nListenStream=127.0.0.1:${port}\nAccept=no\nFileDescriptorName=http\nService=${unit}\n[Install]\nWantedBy=sockets.target\n`,
    { flag: "wx", mode: 0o644 },
  );
  run("daemon-reload");
  run("start", socket);
  assert.equal(state().state, "idle");
  const first = await get();
  assert.equal(first.body, "ok");
  results.firstRequestMilliseconds = first.milliseconds;
  const pid = property("MainPID");
  assert(Number(pid) > 1);
  const pss = /^Pss:\s+(\d+) kB$/m.exec(
    readFileSync(`/proc/${pid}/smaps_rollup`, "utf8"),
  );
  results.fixturePssBytes = Number(pss?.[1]) * 1024;
  await until(() => state().state === "idle");
  assert.equal(property("MainPID"), "0");
  results.checks.push("process-exit-listener-retained");
  const burst = await Promise.all(Array.from({ length: 24 }, () => get()));
  assert(burst.every((r) => r.body === "ok"));
  await until(() => state().state === "idle");
  results.checks.push("first-request-and-parallel-wake");
  const stream = get("/stream");
  await delay(550);
  assert.equal(state().state, "running");
  assert((await stream).body.includes("complete"));
  await until(() => state().state === "idle");
  results.checks.push("stream-not-interrupted");
  const client = connect(port, "127.0.0.1");
  client.on("error", () => {});
  await new Promise((resolve) => client.once("connect", resolve));
  client.write(
    "POST /upload HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\nConnection: close\r\n\r\na",
  );
  await delay(550);
  assert.equal(state().state, "running");
  const reply = new Promise((resolve, reject) => {
    const chunks = [];
    client.on("data", (b) => chunks.push(b));
    client.once("end", () => resolve(Buffer.concat(chunks).toString()));
    client.once("error", reject);
  });
  client.write("b");
  assert((await reply).endsWith("uploaded"));
  client.destroy();
  await until(() => state().state === "idle");
  results.checks.push("unfinished-upload-not-interrupted");
  for (let n = 0; n < 8; n++) {
    assert.equal((await get()).body, "ok");
    await delay(360);
  }
  await until(() => state().state === "idle");
  results.checks.push("idle-boundary-requests");
  controlService("stop", unit, { run, enabled: true });
  assert.equal(state().active, false);
  controlService("start", unit, { run, enabled: true });
  assert.equal(state().state, "idle");
  assert.equal((await get()).body, "ok");
  await until(() => state().state === "idle");
  results.checks.push("quiesce-and-socket-only-resume");
  controlService("stop", unit, { run, enabled: false });
  controlService("start", unit, { run, enabled: false });
  assert.equal((await get()).body, "ok");
  await delay(600);
  assert.equal(state().state, "running");
  results.checks.push("activation-disabled");
  controlService("stop", unit, { run, enabled: false });
  const legacy = join(root, "legacy");
  mkdirSync(join(legacy, "deploy/systemd"), { recursive: true });
  const program = join(root, "legacy.mjs");
  writeFileSync(
    program,
    `import{createServer}from'node:http';createServer((q,s)=>s.end('legacy')).listen(${port},'127.0.0.1');\n`,
    { mode: 0o644 },
  );
  writeFileSync(
    join(legacy, "deploy/systemd", unit),
    `[Service]\nType=simple\nUser=${user}\nExecStart=${node} ${program}\n`,
    { mode: 0o644 },
  );
  prepareHttpActivation(legacy, {
    run,
    unitRoot: "/run/systemd/system",
    values: {},
  });
  controlService("start", unit, { run, enabled: false });
  let legacyReady = false;
  for (let n = 0; n < 20 && !legacyReady; n++) {
    try {
      legacyReady = (await get()).body === "legacy";
    } catch {
      await delay(50);
    }
  }
  assert(legacyReady);
  results.checks.push("legacy-definition-and-port-restoration");
  controlService("stop", unit, { run, enabled: false });
  const broken = join(root, "broken.mjs");
  writeFileSync(broken, "process.exit(1);\n");
  writeFileSync(
    paths[0],
    `[Unit]\nStartLimitIntervalSec=10\nStartLimitBurst=2\n[Service]\nUser=${user}\nExecStart=${node} ${broken}\nRestart=on-failure\nRestartSec=100ms\n`,
  );
  run("daemon-reload");
  run("reset-failed", unit);
  run("start", socket);
  await get().catch(() => {});
  await until(() => property("ActiveState") === "failed");
  assert.equal(state().operational, false);
  results.checks.push("crash-loop-not-healthy-idle");
  results.ok = true;
  console.log(
    JSON.stringify({ event: "http_socket_activation.passed", ...results }),
  );
} finally {
  if (created) {
    for (const name of [socket, unit]) {
      try {
        run("stop", name);
      } catch {
        /* retain primary failure */
      }
    }
    for (const path of paths) if (existsSync(path)) unlinkSync(path);
    run("daemon-reload");
    try {
      run("reset-failed", unit, socket);
    } catch {
      /* absent units */
    }
  }
  rmSync(root, { recursive: true, force: true });
}
