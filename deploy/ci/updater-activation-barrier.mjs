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

const execute = promisify(execFile);
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
  const script = join(root, "controller.mjs");
  const before = await slots.state();
  if (!before.candidate || before.pending)
    throw new Error("Activation barrier requires a clean candidate");
  await writeFile(
    script,
    `
import { createServer } from 'node:http';
import { chmodSync, existsSync, lstatSync, readFileSync, unlinkSync } from 'node:fs';
const socket = '/run/latex-renderer/update-manager.sock';
const token = readFileSync(process.env.UPDATE_MANAGER_TOKEN_FILE, 'utf8').trim();
try { if (!lstatSync(socket).isSocket()) throw Error('not a socket'); unlinkSync(socket); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
createServer((req, res) => {
  if (req.url !== '/v1/state' || req.headers.authorization !== 'Bearer ' + token) {
    res.writeHead(401); res.end(); return;
  }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({activeOperationId: existsSync(${JSON.stringify(committed)}) ? null : 'updop_ci_delayed_commit', lastError: null}));
}).listen(socket, () => chmodSync(socket, 0o660));
`,
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
  } finally {
    await rm(override, { force: true });
    await writeFile(condition, originalCondition, { mode: 0o644 });
    await systemctl("daemon-reload");
    await systemctl("stop", unit);
    await systemctl("start", controller);
    await rm(root, { recursive: true, force: true });
  }
}
