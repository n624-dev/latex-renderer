import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";
import { buffer } from "node:stream/consumers";
import { URL } from "node:url";
import { promisify } from "node:util";
import yauzl from "yauzl";

const [previous, next] = await Promise.all(
  process.argv.slice(2).map(readDistribution),
);
assert(previous && next && previous.manifest.version !== next.manifest.version);
const execute = promisify(execFile);
const temporary = await mkdtemp(join(tmpdir(), "latex-renderer migration "));
const install = join(temporary, "client");
const bin = join(temporary, "bin");
const config = join(temporary, "config");
const windows = process.platform === "win32";
const environment = {
  HOME: temporary,
  USERPROFILE: temporary,
  XDG_CONFIG_HOME: config,
  XDG_DATA_HOME: join(temporary, "data"),
  XDG_BIN_HOME: bin,
  APPDATA: config,
  LOCALAPPDATA: join(temporary, "data"),
  PATH: [bin, dirname(process.execPath), process.env.PATH].join(delimiter),
  LATEX_RENDER_BIN_DIRECTORY: bin,
  TMPDIR: temporary,
  TMP: temporary,
  TEMP: temporary,
  ...(windows
    ? {
        SystemRoot: process.env.SystemRoot,
        ComSpec: process.env.ComSpec,
        WINDIR: process.env.WINDIR,
      }
    : {}),
};
const options = { cwd: temporary, env: environment, timeout: 30_000 };
let distribution = previous;
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/manifest.json")
    response.end(JSON.stringify(distribution.manifest));
  else if (path === "/" + distribution.manifest.archive)
    response.end(distribution.bytes);
  else response.writeHead(404).end();
});
const credential = join(
  config,
  "latex-renderer",
  windows ? "credential.bin" : "credential",
);
const setupArguments = [
  "--install-directory",
  install,
  "--bin-directory",
  bin,
  "--skill-target",
  "none",
  "--mcp-target",
  "none",
  "--json",
];

try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const baseUri = `http://127.0.0.1:${server.address().port}/`;
  const installer = join(temporary, "legacy-install.mjs");
  await writeFile(installer, previous.installer, { flag: "wx" });
  const fixtureCredential = `lrk_${"a".repeat(32)}_${"A".repeat(43)}`;
  const command = execute(
    process.execPath,
    [installer, "--base-uri", baseUri, ...setupArguments, "--api-key-stdin"],
    options,
  );
  command.child.stdin.end(fixtureCredential + "\n");
  assert.equal(
    JSON.parse((await command).stdout).result.credentialStored,
    true,
  );
  const before = await readFile(credential);
  if (windows) assert(!before.includes(fixtureCredential));
  assert.equal(
    await run("latex-render", ["--version"]),
    previous.manifest.version,
  );
  const existingMcp = launcherPath("latex-renderer-mcp");
  await checkMcp(existingMcp);

  distribution = next;
  const updateArguments = ["--base-uri", baseUri, ...setupArguments];
  let updateOutput;
  if (windows) {
    // The previous Stable external CMD shim runs the bundled CLI using Node's
    // eval mode. Its Commander parser treats the injected script path as an
    // argument, so migration from that version uses the current installer.
    const currentInstaller = join(temporary, "current-install.mjs");
    await writeFile(currentInstaller, next.installer, { flag: "wx" });
    updateOutput = (
      await execute(
        process.execPath,
        [currentInstaller, ...updateArguments],
        options,
      )
    ).stdout;
  } else {
    updateOutput = await run("latex-render", ["setup", ...updateArguments]);
    // The old installer knows only the old launcher names. Repair runs the
    // installed version and registers the new launcher.
    assert.equal(
      JSON.parse(await run("latex-render", ["setup", "repair", "--json"]))
        .success,
      true,
    );
  }
  const updated = JSON.parse(updateOutput);
  assert.equal(updated.success, true);
  assert.equal(updated.result.action, "updated");
  for (const name of ["latex-render", "n624-latex"]) {
    assert.equal(await run(name, ["--version"]), next.manifest.version);
    assert.equal(
      JSON.parse(await run(name, ["auth", "status", "--json"])).result
        .configured,
      true,
    );
  }
  assert(before.equals(await readFile(credential)));
  await checkMcp(existingMcp);
  process.stdout.write(
    `Packaged CLI migration passed on ${process.platform}.\n`,
  );
} finally {
  server.closeAllConnections();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  try {
    if (windows) {
      // Remove the fixture's user PATH entry even when an assertion failed.
      const uninstaller = join(install, "uninstall.mjs");
      if (await lstat(uninstaller).catch(() => undefined)) {
        await execute(
          process.execPath,
          [uninstaller, "--install-directory", install, "--bin-directory", bin],
          options,
        );
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function readDistribution(path) {
  const name = basename(path);
  const version =
    /^latex-renderer-client-(\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?)\.zip$/.exec(
      name,
    )?.[1];
  assert(version, "Unexpected client release archive name");
  const bytes = await readFile(path);
  const zip = await yauzl.fromBufferPromise(bytes, {
    lazyEntries: true,
    strictFileNames: true,
  });
  let installer;
  try {
    for await (const entry of zip.eachEntry()) {
      if (entry.fileName === "latex-renderer-client/install.mjs") {
        assert(entry.uncompressedSize < 4 * 1024 ** 2);
        installer = await buffer(await zip.openReadStreamPromise(entry));
        break;
      }
    }
  } finally {
    zip.close();
  }
  assert(installer);
  return {
    bytes,
    installer,
    manifest: {
      version,
      archive: name,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.length,
      minimumNodeVersion: "24.0.0",
    },
  };
}

function launcherPath(name) {
  return join(bin, name + (windows ? ".cmd" : ""));
}

function launcherCommand(path, args) {
  if (!windows) return { executable: path, args, options };
  assert([path, ...args].every((value) => !/["%\r\n]/.test(value)));
  const quoted = [path, ...args].map((value) => `"${value}"`).join(" ");
  return {
    executable: environment.ComSpec,
    args: ["/d", "/s", "/c", `"${quoted}"`],
    options: { ...options, windowsVerbatimArguments: true },
  };
}

async function run(name, args) {
  const command = launcherCommand(launcherPath(name), args);
  return (
    await execute(command.executable, command.args, command.options)
  ).stdout.trim();
}

async function checkMcp(path) {
  const command = launcherCommand(path, []);
  const child = spawn(command.executable, command.args, {
    ...command.options,
    stdio: ["pipe", "pipe", "ignore"],
  });
  const closed = new Promise((resolve) => child.once("close", resolve));
  const lines = createInterface({ input: child.stdout });
  try {
    const response = new Promise((resolve, reject) => {
      child.once("error", reject);
      lines.once("line", resolve);
      lines.once("close", () => reject(new Error("No MCP response")));
    });
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "cli-migration", version: "1" },
        },
      }) + "\n",
    );
    assert(JSON.parse(await response).result?.serverInfo?.name);
  } finally {
    child.stdin.end();
    lines.close();
    await closed;
  }
}
