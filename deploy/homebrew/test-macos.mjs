import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL, URL } from "node:url";
import { promisify } from "node:util";
import {
  checkPackagedMcp,
  checkPackagedRender,
  digest,
  fixtureCredential,
} from "../../client/managed-package-fixture.mjs";
import { validReleaseVersion } from "../scripts/release-version.mjs";
import { renderHomebrewFormula } from "./formula.mjs";

assert.equal(process.platform, "darwin");
const [archive, legacyArchive] = process.argv
  .slice(2)
  .map((path) => resolve(path));
assert(archive && legacyArchive);
const version = releaseVersion(archive);
const legacyVersion = releaseVersion(legacyArchive);
const exec = promisify(execFile);
const brewEnv = {
  ...process.env,
  HOMEBREW_NO_AUTO_UPDATE: "1",
  HOMEBREW_NO_INSTALL_CLEANUP: "1",
};
const brew = async (...args) =>
  (await exec("brew", args, { env: brewEnv, timeout: 240_000 })).stdout.trim();
const prefix = await brew("--prefix");
const prefixBin = join(prefix, "bin");
const publishedCli = join(prefixBin, "n624-latex");
const publishedMcp = join(prefixBin, "latex-renderer-mcp");
for (const name of [
  "n624-latex",
  "latex-render",
  "latex-render-admin",
  "latex-renderer-mcp",
])
  await assert.rejects(lstat(join(prefixBin, name)), { code: "ENOENT" });
assert(!(await brew("list", "--formula")).split("\n").includes("n624-latex"));
const stage = await mkdtemp(join(tmpdir(), "n624-homebrew-ci-"));
const tap = `n624-ci-${process.pid}/managed-client`;
const formula = `${tap}/n624-latex`;
const tapRoot = join(stage, "tap");
const formulaName = "Formula/n624-latex.rb";
const home = join(stage, "home");
const legacyBin = join(home, ".local", "bin");
const mcpState = join(home, "fixture-mcp.json");
const config = join(home, ".config");
const legacyInstaller = join(stage, "install.mjs");
const legacyZip = await readFile(legacyArchive);
const archiveName = basename(legacyArchive);
const legacyManifest = {
  version: legacyVersion,
  archive: archiveName,
  sha256: digest(legacyZip),
  size: legacyZip.length,
  minimumNodeVersion: "24.0.0",
};
const env = {
  HOME: home,
  XDG_CONFIG_HOME: config,
  PATH: [
    prefixBin,
    legacyBin,
    dirname(process.execPath),
    "/usr/bin",
    "/bin",
  ].join(":"),
  TMPDIR: stage,
  FIXTURE_MCP_STATE: mcpState,
  LATEX_RENDER_BIN_DIRECTORY: legacyBin,
};
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/manifest.json") response.end(JSON.stringify(legacyManifest));
  else if (path === "/" + archiveName) response.end(legacyZip);
  else response.writeHead(404).end();
});
const cli = async (cmd, args, options = {}) =>
  (
    await exec(cmd, args, { env, cwd: stage, timeout: 20_000, ...options })
  ).stdout.trim();
const credential = join(config, "latex-renderer", "credential");
let tapped = false;
let brewFormulaPath;
try {
  await mkdir(join(tapRoot, "Formula"), { recursive: true });
  await mkdir(legacyBin, { recursive: true, mode: 0o700 });
  await writeFile(join(legacyBin, "codex"), syntheticCodex(), { mode: 0o755 });
  const install = await exec("/usr/bin/unzip", [
    "-p",
    legacyArchive,
    "latex-renderer-client/install.mjs",
  ]);
  await writeFile(legacyInstaller, install.stdout);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const installer = exec(
    process.execPath,
    [
      legacyInstaller,
      "--base-uri",
      `http://127.0.0.1:${server.address().port}/`,
      "--bin-directory",
      legacyBin,
      "--api-key-stdin",
      "--json",
      "--mcp-target",
      "codex",
      "--skill-target",
      "none",
    ],
    { env, cwd: stage, timeout: 30_000 },
  );
  installer.child.stdin.end(fixtureCredential + "\n");
  assert.equal(JSON.parse((await installer).stdout).success, true);
  const before = await readFile(credential);
  const registration = async () =>
    JSON.parse(await readFile(mcpState, "utf8")).transport.command;
  const legacyMcp = await registration();
  assert.notEqual(legacyMcp, publishedMcp);
  await checkPackagedMcp(
    spawn(legacyMcp, [], { env, stdio: ["pipe", "pipe", "ignore"] }),
  );

  const fixture = pathToFileURL(archive);
  const sha256 = digest(await readFile(archive));
  await writeFile(
    join(tapRoot, formulaName),
    renderHomebrewFormula(version, sha256, { fixture }),
  );
  await exec("git", ["init", "-q", "-b", "main"], { cwd: tapRoot });
  await exec("git", ["add", "."], { cwd: tapRoot });
  await exec(
    "git",
    [
      "-c",
      "user.name=Homebrew Fixture",
      "-c",
      "user.email=homebrew-fixture@example.invalid",
      "commit",
      "-qm",
      "Formula fixture",
    ],
    { cwd: tapRoot },
  );
  await brew("tap", tap, tapRoot);
  tapped = true;
  brewFormulaPath = join(await brew("--repo", tap), formulaName);
  await brew("install", formula);
  await brew("test", formula);
  assert.equal(await cli(publishedCli, ["--version"]), version);
  const freshHome = join(stage, "fresh-home");
  await mkdir(freshHome, { mode: 0o700 });
  const freshEnv = { ...env, HOME: freshHome, XDG_CONFIG_HOME: freshHome };
  const freshSetup = exec(
    publishedCli,
    ["setup", "--api-key-stdin", "--json"],
    { env: freshEnv, cwd: stage, timeout: 20_000 },
  );
  freshSetup.child.stdin.end(fixtureCredential + "\n");
  assert.equal(JSON.parse((await freshSetup).stdout).result.configured, true);
  assert.equal(
    JSON.parse(
      await cli(publishedCli, ["auth", "status", "--json"], { env: freshEnv }),
    ).result.configured,
    true,
  );
  assert.equal(
    await cli(join(prefixBin, "latex-render"), ["--version"]),
    version,
  );
  assert.match(
    await cli(join(prefixBin, "latex-render-admin"), ["--help"]),
    /Usage:/,
  );
  assert.equal(
    JSON.parse(await cli(publishedCli, ["auth", "status", "--json"])).result
      .configured,
    true,
  );
  assert.deepEqual(await readFile(credential), before);
  await assert.rejects(
    cli(publishedCli, ["setup", "remove", "--yes", "--json"]),
    (error) => JSON.parse(error.stdout).error.code === "PACKAGE_MANAGED_CLIENT",
  );
  const configured = JSON.parse(
    await cli(publishedCli, [
      "setup",
      "integrations",
      "--mcp-target",
      "codex",
      "--skill-target",
      "none",
      "--json",
    ]),
  );
  assert.equal(configured.success, true);
  assert.equal(await registration(), publishedMcp);
  await checkPackagedMcp(
    spawn(await registration(), [], { env, stdio: ["pipe", "pipe", "ignore"] }),
  );
  await checkPackagedRender(join(stage, "render"), (cwd, endpoint) =>
    cli(publishedCli, ["main.tex"], {
      cwd,
      env: { ...env, LATEX_RENDER_BASE_URL: endpoint },
    }),
  );

  // A formula revision advances Homebrew's package version while using the
  // exact same ZIP. This checks the upgrade lifecycle for the first release.
  await writeFile(
    brewFormulaPath,
    renderHomebrewFormula(version, sha256, { fixture, revision: 1 }),
  );
  await brew("upgrade", formula);
  await brew("cleanup", "--prune=all", formula);
  assert.match(
    await brew("list", "--versions", formula),
    new RegExp(` ${version.replaceAll(".", "\\.")}_1(?: |$)`),
  );
  const kegBin = join(await realpath(await brew("--prefix", formula)), "bin");
  assert.equal(await realpath(publishedCli), join(kegBin, "n624-latex"));
  assert.equal(
    await realpath(publishedMcp),
    join(kegBin, "latex-renderer-mcp"),
  );
  assert.equal(await cli(publishedCli, ["--version"]), version);
  assert.deepEqual(await readFile(credential), before);
  assert.equal(await registration(), publishedMcp);
  await checkPackagedMcp(
    spawn(await registration(), [], { env, stdio: ["pipe", "pipe", "ignore"] }),
  );

  await brew("uninstall", "--force", formula);
  await assert.rejects(lstat(publishedCli), { code: "ENOENT" });
  await assert.rejects(lstat(publishedMcp), { code: "ENOENT" });
  assert.deepEqual(await readFile(credential), before);
  assert.equal(await registration(), publishedMcp);
  assert((await lstat(legacyMcp)).isFile());
  process.stdout.write(
    `Homebrew package lifecycle passed on macOS ${process.arch}.\n`,
  );
} finally {
  server.closeAllConnections();
  if (server.listening) await new Promise((close) => server.close(close));
  try {
    if (tapped) {
      if ((await brew("list", "--formula")).split("\n").includes("n624-latex"))
        await brew("uninstall", "--force", formula);
      await brew("untap", tap);
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

function releaseVersion(path) {
  const version = /^latex-renderer-client-(.+)\.zip$/.exec(basename(path))?.[1];
  return validReleaseVersion(version);
}

function syntheticCodex() {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const state = process.env.FIXTURE_MCP_STATE;
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("fixture-codex 1");
} else if (args[0] === "mcp" && args[1] === "add" && args[2] === "latex-renderer" && args[3] === "--") {
  fs.writeFileSync(state, JSON.stringify({ enabled: true, transport: { type: "stdio", command: args[4], args: args.slice(5) } }));
} else if (args[0] === "mcp" && args[1] === "get" && args[2] === "latex-renderer") {
  if (!fs.existsSync(state)) {
    console.error("No MCP server found");
    process.exitCode = 1;
  } else console.log(fs.readFileSync(state, "utf8"));
} else if (args[0] === "mcp" && args[1] === "remove" && args[2] === "latex-renderer") {
  fs.unlinkSync(state);
} else process.exitCode = 1;
`;
}
