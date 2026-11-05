import { execFile } from "node:child_process";
import {
  chmod,
  chown,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";

const execute = promisify(execFile);
export async function waitForControllerState(
  read,
  {
    now = () => performance.now(),
    wait = () => setTimeout(250),
    timeoutMs = 30_000,
  } = {},
) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    try {
      return await read();
    } catch (error) {
      if (error.code !== "UPDATER_CONTROLLER_UNAVAILABLE") throw error;
    }
    await wait();
  }
  throw new Error(
    "Installed controller did not become ready before the probe deadline",
  );
}
export function activationBarrierControllerSource({
  socket,
  committed,
  timedOut,
  invalid,
}) {
  return `
import { createServer } from 'node:http';
import { chmodSync, existsSync, lstatSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
const socket = ${JSON.stringify(socket)};
const token = readFileSync(process.env.UPDATE_MANAGER_TOKEN_FILE, 'utf8').trim();
try { if (!lstatSync(socket).isSocket()) throw Error('not a socket'); unlinkSync(socket); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
let reads = 0;
createServer((req, res) => {
  if (req.headers.authorization !== 'Bearer ' + token) {
    res.writeHead(401); res.end(); return;
  }
  // Exercise compatibility with a historical controller's real 404 response.
  if (req.url !== '/v1/state') { res.writeHead(404); res.end(); return; }
  if (existsSync(${JSON.stringify(invalid)})) { res.end('{'); return; }
  if (reads++ === 0) {
    // Deterministic network stall, with no artificial memory/disk pressure.
    res.once('close', () => {
      if (!res.writableEnded) writeFileSync(${JSON.stringify(timedOut)}, 'timed-out', {mode: 0o640});
    });
    return;
  }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({activeOperationId: existsSync(${JSON.stringify(committed)}) ? null : 'updop_ci_delayed_commit', lastError: null}));
}).listen(socket, () => chmodSync(socket, 0o660));
`;
}

// Disposable-host regression for the real installed systemd gate. No memory or
// disk-pressure fixture: the completion barrier is delayed deterministically.
export async function verifyActivationCommitBarrier(slots) {
  const unit = "latex-renderer-updater-activate.service";
  const controller = "latex-renderer-update-manager.service";
  const systemctl = (...args) =>
    execute("/usr/bin/systemctl", args, { timeout: 300_000 });
  const property = async (name, key) =>
    (
      await systemctl("show", name, `--property=${key}`, "--value")
    ).stdout.trim();
  const root = await mkdtemp("/run/latex-renderer/activation-e2e-");
  await chown(root, 0, (await lstat("/run/latex-renderer")).gid);
  await chmod(root, 0o750);
  const overrideRoot = `/run/systemd/system/${controller}.d`;
  const override = join(overrideRoot, "90-ci-activation-barrier.conf");
  const condition = `/run/systemd/system/${unit}.d/90-ci-explicit-activation.conf`;
  const originalCondition = await readFile(condition);
  const committed = join(root, "committed");
  const timedOut = join(root, "timed-out");
  const invalid = join(root, "invalid-state");
  const script = join(root, "controller.mjs");
  const before = await slots.state();
  if (!before.candidate || before.pending)
    throw new Error(
      `Activation barrier requires a clean candidate: ${JSON.stringify(before)}`,
    );
  await writeFile(timedOut, "", { mode: 0o640 });
  const controllerOwner = await lstat("/var/lib/latex-renderer/update-manager");
  await chown(timedOut, controllerOwner.uid, controllerOwner.gid);
  await writeFile(
    script,
    activationBarrierControllerSource({
      socket: "/run/latex-renderer/update-manager.sock",
      committed,
      timedOut,
      invalid,
    }),
    { mode: 0o644 },
  );

  try {
    await mkdir(overrideRoot, { recursive: true });
    await writeFile(
      override,
      `[Service]\nExecStart=\nExecStart=/usr/local/bin/node ${script}\n`,
      { mode: 0o644 },
    );
    await systemctl("daemon-reload");
    await systemctl("restart", controller);
    const oldPid = await property(controller, "MainPID");
    if (!/^[1-9]\d*$/.test(oldPid))
      throw new Error("Barrier controller did not start");
    // Allow the fixture socket to become ready before the production gate's
    // bounded authenticated request. Its startup never mutates durable state.
    await setTimeout(1000);
    await rm(condition);
    await systemctl("daemon-reload");
    await systemctl("start", "--no-block", unit);
    // Longer than the former 10-second cutover delay, with no helper lock held.
    for (let elapsed = 0; elapsed < 14; elapsed++) {
      await setTimeout(1000);
      if (
        (await property(controller, "MainPID")) !== oldPid ||
        (await property(unit, "ActiveState")) !== "activating" ||
        JSON.stringify(await slots.state()) !== JSON.stringify(before)
      )
        throw new Error(
          "Updater restarted or switched before application commit",
        );
    }
    if ((await readFile(timedOut, "utf8")) !== "timed-out")
      throw new Error("The activation request timeout was not observed");
    // The installed unit's real ExecStopPost must not stop an uncommitted
    // controller even when activation is explicitly interrupted before cutover.
    await systemctl("stop", unit);
    if (
      (await property(controller, "MainPID")) !== oldPid ||
      JSON.stringify(await slots.state()) !== JSON.stringify(before)
    )
      throw new Error(
        "Interrupted activation cleanup stopped a busy controller",
      );
    // A permanent read/validation failure also invokes ExecStopPost. Unknown
    // controller state must preserve management rather than restart it.
    await writeFile(invalid, "invalid\n", { mode: 0o644 });
    let rejected = false;
    try {
      await systemctl("start", unit);
    } catch {
      rejected = true;
    }
    await systemctl("stop", unit).catch(() => {});
    if (
      !rejected ||
      (await property(controller, "MainPID")) !== oldPid ||
      JSON.stringify(await slots.state()) !== JSON.stringify(before)
    )
      throw new Error(
        "Failed activation cleanup stopped an unverified controller",
      );
    await rm(invalid);
    // The gate must stop the idle controller under the shared lock, then start
    // the real candidate using the unchanged frozen bootstrap and health check.
    await rm(override);
    await systemctl("daemon-reload");
    await writeFile(committed, "committed\n", { mode: 0o644 });
    await systemctl("start", unit);
    const after = await slots.state();
    if (
      after.current !== before.candidate ||
      after.previous !== before.current ||
      after.candidate ||
      after.pending ||
      (await property(unit, "Result")) !== "success"
    )
      throw new Error("Committed application did not activate its Updater");
    const { controllerIdle, readControllerState } =
      await import("/usr/local/libexec/latex-renderer-updater-activation.mjs");
    // Type=simple start completes before Node binds its Unix listener. Only
    // transient readiness errors may be waited out; invalid/auth state fails.
    const state = await waitForControllerState(readControllerState);
    if (
      !controllerIdle(state) ||
      JSON.stringify(Object.keys(state).sort()) !==
        JSON.stringify(["activeOperationId", "lastError"])
    )
      throw new Error(
        "Installed controller did not serve its lightweight commit barrier",
      );
    console.log(
      JSON.stringify({
        event: "ci.updater_activation_cleanup.passed",
        timeoutRetried: true,
        historicalFallback: true,
        interruptedControllerPreserved: true,
        invalidStateControllerPreserved: true,
        committedCutover: true,
        lightweightState: true,
      }),
    );
  } finally {
    await rm(override, { force: true });
    await rm(invalid, { force: true });
    await writeFile(condition, originalCondition, { mode: 0o644 });
    await systemctl("daemon-reload");
    await systemctl("stop", unit).catch(() => {});
    // The fixture can deliberately remain busy after a failed assertion.
    // Only this disposable test owns it; explicitly remove it during cleanup.
    await systemctl("stop", controller);
    await systemctl("start", controller);
    await rm(root, { recursive: true, force: true });
  }
}
