#!/usr/bin/env node
import { isMainModule } from "./is-main-module.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { validateServerSetupReview } from "../../packages/server-setup-core/src/index.mjs";
import { runServerSetupCui } from "./server-setup-cui.mjs";
import { startServerSetupWeb } from "./server-setup-web.mjs";
import { cleanupServerSetupInputs } from "./server-setup-inputs.mjs";
import { runServerInitialCui } from "./server-setup-initial-cui.mjs";
import { createInitialServerSetupHost } from "./server-setup-initial-host.mjs";
import { prepareServerApplication } from "./server-setup-prepare.mjs";
import { AuthenticationChangeStore } from "./authentication-change.mjs";
import { importServerSetupReview } from "../../packages/server-setup-core/src/index.mjs";

const command = promisify(execFile);
const inputRoot = "/etc/latex-renderer/setup-inputs";
const configurePath =
  "/opt/latex-renderer/current/deploy/scripts/configure-authentication.mjs";

async function requireRootParents(path, uid = 0) {
  for (let parent = path; ; parent = dirname(parent)) {
    const info = await lstat(parent);
    if (
      !info.isDirectory() ||
      ![0, uid].includes(info.uid) ||
      info.mode & 0o022 ||
      (await realpath(parent)) !== parent
    )
      throw new Error("Setup requires root-controlled directories");
    if (parent === "/") return;
  }
}

export async function serverSetupChildEnvironment(extraCa, uid = 0) {
  const environment = { PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8" };
  if (extraCa !== undefined) {
    if (typeof extraCa !== "string" || !extraCa.startsWith("/"))
      throw new Error("Extra CA trust requires an absolute path");
    const ca = await realpath(extraCa);
    await requireRootParents(dirname(ca), uid);
    const info = await lstat(ca);
    if (
      !info.isFile() ||
      info.uid !== uid ||
      info.mode & 0o022 ||
      info.size < 1 ||
      info.size > 2 * 1024 ** 2
    )
      throw new Error(
        "Extra CA trust must be a bounded root-controlled regular file",
      );
    environment.NODE_EXTRA_CA_CERTS = ca;
  }
  return Object.freeze(environment);
}

/** Reuse the installed, fixed-path host transaction. Browser input never
 * selects a command, path, systemd unit, release or secret slot. Full env and
 * child error/response bodies never reach a frontend.
 */
export async function createPreparedServerSetupHost() {
  if (process.geteuid?.() !== 0)
    throw new Error("Server setup must run as root");
  await requireRootParents("/etc/latex-renderer");
  await mkdir(inputRoot, { mode: 0o700 }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  const directory = await lstat(inputRoot);
  if (
    directory.uid !== 0 ||
    directory.gid !== 0 ||
    (directory.mode & 0o7777) !== 0o700
  )
    throw new Error("Setup input directory must be private and root owned");
  await requireRootParents(inputRoot);
  await cleanupServerSetupInputs(inputRoot);
  // current is the existing release-manager-controlled symlink. Verify its
  // resolved target, not an arbitrary path supplied by a wizard request.
  const entry = await realpath(configurePath);
  if (
    !/^\/opt\/latex-renderer\/releases\/[A-Za-z0-9._-]+\/deploy\/scripts\/configure-authentication\.mjs$/.test(
      entry,
    )
  )
    throw new Error("A verified managed release must already be installed");
  await requireRootParents(dirname(entry));
  const entryInfo = await lstat(entry);
  if (!entryInfo.isFile() || entryInfo.uid !== 0 || entryInfo.mode & 0o022)
    throw new Error("The installed setup entrypoint must be root controlled");
  // Retain explicitly configured private-CA trust, never TLS-disable switches
  // or arbitrary ambient credentials. Node loads extra CAs at process start.
  const childEnvironment = await serverSetupChildEnvironment(
    process.env.NODE_EXTRA_CA_CERTS,
  );
  async function run(action, input) {
    let path;
    try {
      if (input !== undefined) {
        path = `${inputRoot}/${randomBytes(24).toString("hex")}.json`;
        const handle = await open(
          path,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        try {
          await handle.writeFile(`${JSON.stringify(input)}\n`);
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
      const { stdout } = await command(
        process.execPath,
        [entry, action, ...(path ? [path] : [])],
        {
          timeout: action === "--setup-apply" ? 25 * 60_000 : 30_000,
          maxBuffer: 128 * 1024,
          // Do not forward a credential-bearing ambient environment to a child.
          env: childEnvironment,
        },
      );
      return ["--setup-apply", "--recover"].includes(action)
        ? undefined
        : JSON.parse(stdout);
    } catch {
      throw new Error(
        "Prepared host operation failed; inspect private recovery state",
      );
    } finally {
      if (path) {
        const info = await lstat(path).catch(() => null);
        if (
          info?.isFile() &&
          info.uid === 0 &&
          info.gid === 0 &&
          info.nlink === 1 &&
          (info.mode & 0o7777) === 0o600
        )
          await unlink(path);
      }
    }
  }
  // Probe before opening the frontend; an unprepared/fresh host must not be
  // misreported as an installed environment or cause an implicit bootstrap.
  async function current() {
    try {
      return await run("--setup-export");
    } catch {
      const gid = directory.gid;
      const store = new AuthenticationChangeStore(
        "/etc/latex-renderer/renderer.env",
        "/etc/latex-renderer/authentication-transaction",
        0,
        gid,
      );
      const journal = await store.journal();
      if (!journal) throw new Error("Existing host is unavailable");
      return importServerSetupReview(journal.before);
    }
  }
  validateServerSetupReview(await current());
  return Object.freeze({
    current,
    preview: (review) => run("--setup-review", review),
    apply: (envelope) => run("--setup-apply", envelope),
    recover: async () => {
      await run("--recover");
      return {};
    },
  });
}

async function main() {
  const [mode, scope, ...rest] = process.argv.slice(2);
  if (
    !["--cui", "--web"].includes(mode) ||
    !["--existing", "--initial", "--ingress"].includes(scope)
  )
    throw new Error(
      "usage: server-setup.mjs --cui|--web --existing|--initial|--ingress [--lan ADDRESS --allow-network CIDR --acknowledge-plaintext-lan] (prepared host only)",
    );
  const webOptions = {};
  for (let i = 0; i < rest.length; i++) {
    if (mode !== "--web") throw new Error("LAN options require Web frontend");
    if (rest[i] === "--lan" && !webOptions.listenAddress)
      webOptions.listenAddress = rest[++i];
    else if (rest[i] === "--allow-network")
      (webOptions.allowedNetworks ??= []).push(rest[++i]);
    else if (
      rest[i] === "--acknowledge-plaintext-lan" &&
      !webOptions.acknowledgePlaintextLan
    )
      webOptions.acknowledgePlaintextLan = true;
    else throw new Error("Invalid setup listener options");
  }
  if (webOptions.acknowledgePlaintextLan && !webOptions.listenAddress)
    throw new Error("LAN acknowledgement requires explicit address");
  if (scope === "--initial") await prepareServerApplication();
  const host =
    scope === "--existing"
      ? await createPreparedServerSetupHost()
      : await createInitialServerSetupHost(
          scope === "--initial" ? "initial" : "ingress",
        );
  if (mode === "--cui") {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      throw new Error("CUI requires a trusted interactive terminal");
    let muted = false;
    const output = new Writable({
      write(chunk, _encoding, callback) {
        if (!muted) process.stdout.write(chunk);
        callback();
      },
    });
    const terminal = createInterface({
      input: process.stdin,
      output,
      terminal: true,
      historySize: 0,
    });
    try {
      await (scope === "--existing" ? runServerSetupCui : runServerInitialCui)(
        host,
        {
          ask: (prompt) => terminal.question(prompt),
          askSecret: async (prompt) => {
            process.stdout.write(prompt);
            muted = true;
            try {
              return await terminal.question("");
            } finally {
              muted = false;
              process.stdout.write("\n");
            }
          },
          readFile: async (path, maximum) => {
            const handle = await open(
              path,
              constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
            );
            try {
              const info = await handle.stat();
              if (!info.isFile() || info.size < 1 || info.size > maximum)
                throw new Error("Invalid bounded PEM file");
              const bytes = Buffer.alloc(maximum + 1);
              const { bytesRead } = await handle.read(
                bytes,
                0,
                bytes.length,
                0,
              );
              if (bytesRead !== info.size)
                throw new Error("PEM file changed while reading");
              return bytes.subarray(0, bytesRead).toString("utf8");
            } finally {
              await handle.close();
            }
          },
          print: (message) => process.stdout.write(`${message}\n`),
        },
      );
    } finally {
      terminal.close();
    }
  } else {
    if (webOptions.listenAddress)
      process.stdout.write(
        "WARNING: temporary plaintext HTTP on a trusted LAN exposes bootstrap credentials to that network. Prefer SSH forwarding. Never use an untrusted/public network.\n",
      );
    const web = await startServerSetupWeb(host, webOptions);
    process.stdout.write(
      `Private one-use setup URL (expires in 5 minutes):\n${web.bootstrapUrl}\nUse a same-host browser or SSH port forwarding. Never publish this port or share this URL.\n`,
    );
    const stop = () => web.close();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    await web.closed;
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
if (isMainModule(import.meta.url)) {
  main().catch(() => {
    process.stderr.write(
      "Server setup failed. Use a prepared managed host and inspect private recovery state; no installation was certified.\n",
    );
    process.exitCode = 1;
  });
}
