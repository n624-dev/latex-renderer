import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, lstat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { URL, URLSearchParams } from "node:url";
import { httpServiceStatus } from "../scripts/http-services.mjs";

// Only called after signed candidate installation on a disposable update-CI
// host. Production acceptance uses the real configured timeout instead.
export async function verifyHttpApplicationIdle() {
  assert.equal(process.getuid(), 0);
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
  const markerPath = "/etc/latex-renderer-ci-host.json",
    info = await lstat(markerPath);
  assert(info.isFile() && info.uid === 0 && !(info.mode & 0o077));
  const marker = JSON.parse(await readFile(markerPath, "utf8"));
  assert.equal(marker.runId, process.env.GITHUB_RUN_ID);
  assert.equal(
    marker.bootId,
    (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(),
  );
  const envPath = "/etc/latex-renderer/renderer.env",
    before = await readFile(envPath, "utf8");
  const origin = /^PUBLIC_ORIGIN=(https:\/\/[^\s]+)$/m.exec(before)?.[1];
  assert(origin, "Missing fixture origin");
  const names = ["api", "web", "admin-api", "internal-api", "remote-mcp"],
    units = names.map((name) => `latex-renderer-${name}.service`);
  const run = (...args) =>
    execFileSync("/usr/bin/systemctl", args, {
      encoding: "utf8",
      timeout: 30000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const cookies = (response) =>
    response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
  const request = async (port, path, options = {}, expected = 200) => {
    let response;
    try {
      response = await globalThis.fetch(`http://127.0.0.1:${port}${path}`, {
        ...options,
        redirect: "manual",
        signal: globalThis.AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error("Application idle fixture HTTP request failed");
    }
    assert.equal(
      response.status,
      expected,
      "Application idle fixture HTTP status",
    );
    return response;
  };
  const json = (body) => ({
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
  // Provision through the real HTTP API, then explicitly restart as setup.
  // The subsequent idle cycle starts with a DB-backed client and no in-memory
  // registration window. Unit tests separately prove that live DCR windows
  // and refresh-retry replies prevent premature sleep.
  const registered = await request(
    3104,
    "/oauth/register",
    {
      ...json({
        client_name: "HTTP idle acceptance",
        redirect_uris: ["http://127.0.0.1:49152/callback"],
      }),
      headers: {
        ...json({}).headers,
        "X-Latex-Renderer-Client-IP": "192.0.2.42",
      },
    },
    201,
  );
  const client = await registered.json();
  assert(typeof client.client_id === "string", "Missing fixture OAuth client");
  const restart = () =>
    run("/usr/local/bin/node", [
      "/opt/latex-renderer/current/deploy/scripts/http-services.mjs",
      "reconcile",
    ]);
  let results;
  try {
    // Exercise the documented environment-only operation in both directions.
    // An unchanged settings-wizard review intentionally does not reload env.
    await writeFile(
      envPath,
      before.replace(/^HTTP_IDLE_(?:ENABLED|TIMEOUT_SECONDS)=.*\n?/gm, "") +
        "\nHTTP_IDLE_ENABLED=false\nHTTP_IDLE_TIMEOUT_SECONDS=30\n",
    );
    restart();
    for (const unit of units)
      assert.equal(httpServiceStatus(unit).state, "running");
    for (const port of [3100, 3101, 3102, 3103])
      await (await request(port, "/health")).text();
    await writeFile(
      envPath,
      before.replace(/^HTTP_IDLE_(?:ENABLED|TIMEOUT_SECONDS)=.*\n?/gm, "") +
        "\nHTTP_IDLE_ENABLED=true\nHTTP_IDLE_TIMEOUT_SECONDS=30\n",
    );
    restart();
    const login = await request(
      3102,
      "/auth/password/login",
      json({
        loginName: "release-e2e",
        password: (
          await readFile("/etc/latex-renderer/ci/password", "utf8")
        ).trim(),
      }),
    );
    const loginResult = await login.json(),
      sessionCookie = cookies(login);
    assert(
      loginResult.authenticated === true && sessionCookie.length > 0,
      "Fixture login failed",
    );
    const verifier = randomBytes(48).toString("base64url");
    const query = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: "http://127.0.0.1:49152/callback",
      scope: "mcp:read",
      resource: `${origin}/mcp`,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      state: "idle-acceptance",
    });
    const consent = await request(3104, `/oauth/authorize?${query}`, {
      headers: { Cookie: sessionCookie },
    });
    const consentCookie = cookies(consent);
    await consent.text();
    const csrf = /oauth_csrf_([A-Za-z0-9_-]{32})=/.exec(consentCookie)?.[1];
    assert(csrf, "Missing fixture OAuth consent");
    for (const port of [3100, 3101, 3103])
      await (await request(port, "/health")).text();
    const pss = async () => {
      let total = 0;
      for (const unit of units) {
        const actual = httpServiceStatus(unit).service;
        const pid = Number(
          run("show", "-p", "MainPID", "--value", actual).trim(),
        );
        if (pid) {
          const text = await readFile(`/proc/${pid}/smaps_rollup`, "utf8");
          total += Number(/^Pss:\s+(\d+) kB$/m.exec(text)?.[1]) * 1024;
        }
      }
      return total;
    };
    const runningPssBytes = await pss(),
      deadline = Date.now() + 65000;
    while (!units.every((unit) => httpServiceStatus(unit).state === "idle")) {
      assert(Date.now() < deadline, "HTTP application process did not sleep");
      await delay(1000);
    }
    for (const unit of units)
      assert.equal(
        run(
          "show",
          "-p",
          "MainPID",
          "--value",
          httpServiceStatus(unit).service,
        ).trim(),
        "0",
      );
    const idlePssBytes = await pss();
    assert.equal(idlePssBytes, 0);
    // Rendering the status page wakes Web alone; it must not wake the APIs.
    await (await request(3101, "/status/")).text();
    for (const unit of units.filter((unit) => !unit.includes("web")))
      assert.equal(httpServiceStatus(unit).state, "idle");
    const start = performance.now();
    const session = await request(3102, "/auth/session", {
      headers: { Cookie: sessionCookie },
    });
    assert(
      (await session.json()).authenticated === true,
      "Login did not survive idle exit",
    );
    const firstAuthenticatedResponseMs = performance.now() - start;
    const approval = new URLSearchParams(query);
    approval.set("csrf", csrf);
    approval.set("decision", "approve");
    const approved = await request(
      3104,
      "/oauth/authorize",
      {
        method: "POST",
        headers: {
          Origin: origin,
          Cookie: `${sessionCookie}; ${consentCookie}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: approval.toString(),
      },
      303,
    );
    const location = approved.headers.get("Location");
    await approved.text();
    assert(location, "Missing OAuth redirect");
    const code = new URL(location).searchParams.get("code");
    assert(code, "Missing OAuth code");
    const tokenRequest = async (body) => {
      const response = await request(3104, "/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body).toString(),
      });
      const value = await response.json();
      assert(
        typeof value.access_token === "string",
        "Missing OAuth access token",
      );
      return value;
    };
    const tokens = await tokenRequest({
      grant_type: "authorization_code",
      client_id: client.client_id,
      code,
      redirect_uri: "http://127.0.0.1:49152/callback",
      code_verifier: verifier,
      resource: `${origin}/mcp`,
    });
    const rpc = async (id, method, params) => {
      const response = await request(3104, "/mcp", {
        ...json({ jsonrpc: "2.0", id, method, params }),
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${tokens.access_token}`,
        },
      });
      const text = await response.text();
      // Streamable HTTP permits both JSON and SSE. Exercise the shipped SDK
      // transport rather than requiring one negotiated representation.
      const data = response.headers
        .get("Content-Type")
        ?.includes("text/event-stream")
        ? text
            .split(/\r?\n/)
            .find((line) => line.startsWith("data: "))
            ?.slice(6)
        : text;
      assert(data, "MCP response has no data event");
      const value = JSON.parse(data);
      assert(
        value.id === id && value.result && !value.error,
        "MCP failed after wake",
      );
    };
    await rpc(1, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "idle-acceptance", version: "1" },
    });
    await rpc(2, "tools/list", {});
    await tokenRequest({
      grant_type: "refresh_token",
      client_id: client.client_id,
      refresh_token: tokens.refresh_token,
      resource: `${origin}/mcp`,
    });
    results = {
      runningPssBytes,
      idlePssBytes,
      firstAuthenticatedResponseMs,
      pendingConsentPreserved: true,
      mcpAfterWake: true,
      passiveStatus: true,
      idleSettingsReconciled: true,
    };
  } finally {
    await writeFile(envPath, before);
    restart();
  }
  console.log(
    JSON.stringify({
      event: "http_application_idle.passed",
      architecture: process.arch,
      ...results,
    }),
  );
}
