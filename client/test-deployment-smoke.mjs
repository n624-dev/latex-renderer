// Exercise fresh packaged clients without a hosting provider, API key or build
// cache. Run after build:client; all installation/configuration paths are private
// temporary fixtures. This is not external-network or TLS acceptance.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, lstat, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import { URL } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const repository = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(
  join(tmpdir(), "latex-renderer-client-deployment-"),
);
let server;
try {
  const manifestBytes = await readFile(
    join(repository, "client-dist/manifest.json"),
  );
  const manifest = JSON.parse(manifestBytes);
  const metadata = JSON.parse(
    await readFile(join(repository, "package.json"), "utf8"),
  );
  assert.equal(manifest.version, metadata.version);
  assert(/^[A-Za-z0-9.-]+\.zip$/.test(manifest.archive));
  assert(
    Number.isSafeInteger(manifest.size) &&
      manifest.size > 0 &&
      manifest.size <= 25 * 1024 ** 2,
  );
  const archive = await readFile(
    join(repository, "client-dist", manifest.archive),
  );
  assert.equal(archive.length, manifest.size);
  let rejectRequests = false;
  let requests = 0;
  server = createServer((request, response) => {
    requests++;
    const path = new URL(request.url, "http://localhost").pathname;
    if (rejectRequests) {
      response.writeHead(503).end("Fixture response is not logged");
      return;
    }
    const payload =
      path === "/manifest.json"
        ? manifestBytes
        : path === "/" + manifest.archive
          ? archive
          : null;
    if (!payload) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-length": String(payload.length) });
    response.end(payload);
  });
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const baseUri = `http://127.0.0.1:${server.address().port}/`;
  const installation = join(temporary, "client");
  const bin = join(temporary, "bin");
  await mkdir(join(temporary, "tmp"));
  // Do not inherit credentials, NODE_OPTIONS, TLS overrides or the real user's
  // XDG configuration. No HOME mutation, OS/service change or external request.
  const env = {
    PATH: bin + ":" + process.env.PATH,
    LANG: "C.UTF-8",
    XDG_CONFIG_HOME: join(temporary, "config"),
    XDG_DATA_HOME: join(temporary, "data"),
    XDG_BIN_HOME: bin,
    TMPDIR: join(temporary, "tmp"),
    LATEX_RENDER_BIN_DIRECTORY: bin,
  };
  const runner = join(repository, "deploy/scripts/deployment-json-check.mjs");
  const installer = join(repository, "client-dist/install.mjs");
  const runCheck = async (step, command, args) => {
    const receipt = join(temporary, step + ".json");
    await exec(process.execPath, [runner, step, receipt, command, ...args], {
      env,
      timeout: 20000,
      maxBuffer: 4096,
    });
    assert.equal((await lstat(receipt)).mode & 0o777, 0o600);
    return JSON.parse(await readFile(receipt, "utf8"));
  };
  const installed = await runCheck("client-install", process.execPath, [
    installer,
    "--base-uri",
    baseUri,
    "--install-directory",
    installation,
    "--bin-directory",
    bin,
    "--skill-target",
    "none",
    "--mcp-target",
    "none",
    "--json",
  ]);
  assert.equal(installed.success, true);
  assert.equal(installed.result.credentialStored, false);
  const doctor = await runCheck("client-doctor", join(bin, "latex-render"), [
    "doctor",
    "--json",
  ]);
  assert.equal(doctor.success, true);
  assert.equal(doctor.result.status, "healthy");
  const removed = await runCheck("client-uninstall", process.execPath, [
    join(repository, "client-dist/uninstall.mjs"),
    "--install-directory",
    installation,
    "--bin-directory",
    bin,
    "--keep-credential",
    "--keep-skills",
    "--json",
  ]);
  assert.equal(removed.result.removed, true);
  await assert.rejects(lstat(installation), { code: "ENOENT" });
  await assert.rejects(
    lstat(join(temporary, "config/latex-renderer/credential")),
    { code: "ENOENT" },
  );
  rejectRequests = true;
  const failedReceipt = join(temporary, "failed.json");
  try {
    await exec(
      process.execPath,
      [
        runner,
        "client-install",
        failedReceipt,
        process.execPath,
        installer,
        "--base-uri",
        baseUri,
        "--skill-target",
        "none",
        "--mcp-target",
        "none",
        "--json",
      ],
      { env, timeout: 20000, maxBuffer: 4096 },
    );
    assert.fail("Rejected HTTP request was accepted");
  } catch (error) {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, "");
    assert(error.stderr.includes('"category":"manifest-http"'));
    assert(error.stderr.includes('"httpStatus":503'));
    assert(!error.stderr.includes("127.0.0.1"));
  }
  await assert.rejects(lstat(failedReceipt), { code: "ENOENT" });
  process.stdout.write(
    JSON.stringify({
      version: manifest.version,
      archiveBytes: archive.length,
      realLoopbackDownload: true,
      installer: true,
      doctorHealthy: true,
      uninstall: true,
      refusedHttp503Logged: true,
      failedReceiptAbsent: true,
      privateReceiptModes: true,
      credentialsWritten: false,
      requests,
    }) + "\n",
  );
} finally {
  server?.closeAllConnections();
  if (server?.listening) await new Promise((done) => server.close(done));
  await rm(temporary, { recursive: true });
  process.stdout.write("Isolated client deployment fixtures removed.\n");
}
