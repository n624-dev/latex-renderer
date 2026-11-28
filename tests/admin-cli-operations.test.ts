import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import { expect, it } from "vitest";
import { readFixtureBody } from "./helpers/fixture-http.js";

const run = promisify(execFile);

it("downloads only from the authenticated Job endpoint and preserves existing local files", async () => {
  const jobId = `job_${"a".repeat(32)}`;
  const bytes = Buffer.from("fixture artifact");
  const paths: string[] = [];
  const server = createServer((request, response) => {
    if (request.headers.authorization !== "Bearer fixture-key") {
      response.writeHead(401).end();
      return;
    }
    paths.push(request.url ?? "");
    if (request.url?.endsWith("/missing.pdf")) {
      response
        .writeHead(404, { "Content-Type": "application/json" })
        .end('{"error":{"code":"ARTIFACT_NOT_FOUND"}}');
      return;
    }
    response
      .writeHead(200, { "Content-Type": "application/octet-stream" })
      .end(bytes);
  });
  const directory = await mkdtemp(join(tmpdir(), "admin-cli-download-"));
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Missing fixture port");
    const origin = `http://127.0.0.1:${address.port}`;
    const destination = join(directory, "artifact");
    const download = (output: string, ...args: string[]) =>
      run(
        process.execPath,
        [
          "--import",
          "tsx",
          "apps/admin-cli/src/index.ts",
          "jobs",
          "download",
          jobId,
          "--output",
          output,
          ...args,
        ],
        {
          env: {
            ...process.env,
            LATEX_RENDER_BASE_URL: origin,
            LATEX_RENDER_TRUSTED_ADMIN_ORIGINS: origin,
            LATEX_RENDER_ADMIN_API_KEY: "fixture-key",
            CF_ACCESS_CLIENT_ID: "",
            CF_ACCESS_CLIENT_SECRET: "",
          },
          timeout: 10_000,
        },
      );
    await download(destination, "--artifact", "previews/page-1.png");
    await expect(readFile(destination)).resolves.toEqual(bytes);
    await expect(download(destination)).rejects.toThrow(/EEXIST/);
    await expect(
      download(join(directory, "missing"), "--artifact", "missing.pdf"),
    ).rejects.toThrow(/ARTIFACT_NOT_FOUND/);
    await expect(
      download(join(directory, "unsafe"), "--artifact", "../archive"),
    ).rejects.toThrow(/relative artifact path/);
    await expect(readdir(directory)).resolves.toEqual(["artifact"]);
    await expect(readFile(destination)).resolves.toEqual(bytes);
    expect(paths).toEqual([
      `/admin/api/v1/jobs/${jobId}/previews/page-1.png`,
      `/admin/api/v1/jobs/${jobId}/archive`,
      `/admin/api/v1/jobs/${jobId}/artifacts/missing.pdf`,
    ]);
  } finally {
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("uses the existing authenticated routes for jobs, backups, audit filtering and runtime settings", async () => {
  const requests: Array<{
    method: string | undefined;
    path: string;
    authorization: string | undefined;
    key: string | string[] | undefined;
    body: unknown;
  }> = [];
  const server = createServer((request, response) => {
    void readFixtureBody(request)
      .then((bytes) => {
        requests.push({
          method: request.method,
          path: request.url ?? "",
          authorization: request.headers.authorization,
          key: request.headers["idempotency-key"],
          body:
            bytes.length === 0 ? undefined : JSON.parse(bytes.toString("utf8")),
        });
        response.setHeader("Content-Type", "application/json");
        response.statusCode = request.method === "POST" ? 202 : 200;
        response.end('{"fixture":true}');
      })
      .catch(() => response.writeHead(400).end());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Expected a fixture port");
    const origin = `http://127.0.0.1:${address.port}`;
    for (const args of [
      [
        "jobs",
        "list",
        "--status",
        "failed",
        "--page-size",
        "15",
        "--cursor",
        "previous result",
        "--json",
      ],
      ["jobs", "retry-svg", "job_test", "--yes"],
      ["jobs", "render-targets"],
      ["jobs", "bulk-delete", "job_one", "job_two", "--yes"],
      [
        "users",
        "update",
        "user_one",
        "--display-name",
        "New name",
        "--clear-email",
        "--yes",
      ],
      [
        "users",
        "unlink-identity",
        "user_one",
        "identity_one",
        "--reason",
        "Provider migration",
        "--yes",
      ],
      [
        "service-accounts",
        "update",
        "account_one",
        "--name",
        "Runner",
        "--client-type",
        "ci",
        "--yes",
      ],
      ["service-accounts", "delete", "account_one", "--yes"],
      [
        "sources",
        "render",
        "source_one",
        "--api-key-id",
        "key_one",
        "--entrypoint",
        "main.tex",
        "--svg",
        "--idempotency-key",
        "fixture-render-request",
        "--yes",
      ],
      [
        "sources",
        "reference",
        "source_one",
        "--api-key-id",
        "key_one",
        "--yes",
      ],
      ["sources", "delete", "source_one", "--yes"],
      ["backup", "create"],
      ["system", "config"],
      [
        "system",
        "config",
        "set",
        "max_queue_length",
        "15",
        "--reason",
        "Queue policy",
        "--yes",
      ],
      [
        "audit",
        "list",
        "--actor",
        "user / owner",
        "--result",
        "failed",
        "--json",
      ],
      [
        "users",
        "set-password",
        "user_one",
        "--login-name",
        "test-user",
        "--password-stdin",
        "--reason",
        "Credential reset",
        "--yes",
      ],
    ]) {
      const execution = run(
        process.execPath,
        ["--import", "tsx", "apps/admin-cli/src/index.ts", ...args],
        {
          timeout: 10_000,
          encoding: "utf8",
          env: {
            ...process.env,
            LATEX_RENDER_BASE_URL: origin,
            LATEX_RENDER_TRUSTED_ADMIN_ORIGINS: origin,
            LATEX_RENDER_ADMIN_API_KEY: "fixture-key",
            CF_ACCESS_CLIENT_ID: "",
            CF_ACCESS_CLIENT_SECRET: "",
          },
        },
      );
      if (args.includes("--password-stdin"))
        execution.child.stdin?.end("Fixture password only\r\n");
      const { stdout } = await execution;
      expect(stdout).not.toContain("Fixture password only");
      const deleted = args[1] === "delete";
      expect(JSON.parse(stdout)).toEqual(
        deleted
          ? args[0] === "service-accounts"
            ? { id: args[2], disabled: true }
            : { id: args[2], accepted: true }
          : { fixture: true },
      );
    }
    expect(requests.map(({ method, path }) => [method, path])).toEqual([
      [
        "GET",
        "/admin/api/v1/jobs?status=failed&pageSize=15&cursor=previous+result",
      ],
      ["POST", "/admin/api/v1/jobs/job_test/retry-svg"],
      ["GET", "/admin/api/v1/jobs/render-targets"],
      ["POST", "/admin/api/v1/jobs/bulk-delete"],
      ["PATCH", "/admin/api/v1/users/user_one"],
      ["POST", "/admin/api/v1/users/user_one/identities/identity_one/unlink"],
      ["PATCH", "/admin/api/v1/service-accounts/account_one"],
      ["DELETE", "/admin/api/v1/service-accounts/account_one"],
      ["POST", "/admin/api/v1/sources/source_one/render"],
      ["POST", "/admin/api/v1/sources/source_one/source-ref"],
      ["DELETE", "/admin/api/v1/sources/source_one"],
      ["POST", "/admin/api/v1/backups/create"],
      ["GET", "/admin/api/v1/system/config"],
      ["PATCH", "/admin/api/v1/system/config"],
      ["GET", "/admin/api/v1/audit-logs?actor=user+%2F+owner&result=failed"],
      ["POST", "/admin/api/v1/users/user_one/password"],
    ]);
    expect(
      requests.every(
        ({ authorization }) => authorization === "Bearer fixture-key",
      ),
    ).toBe(true);
    expect(requests[1]?.key).toMatch(/^[a-f0-9-]{36}$/);
    expect(requests[3]?.body).toEqual({ ids: ["job_one", "job_two"] });
    expect(requests[4]?.body).toEqual({ displayName: "New name", email: null });
    expect(requests[5]?.body).toEqual({ reason: "Provider migration" });
    expect(requests[6]?.body).toEqual({ name: "Runner", clientType: "ci" });
    expect(requests[8]?.key).toBe("fixture-render-request");
    expect(requests[8]?.body).toEqual({
      apiKeyId: "key_one",
      entrypoint: "main.tex",
      outputs: ["pdf", "svg"],
    });
    expect(requests[9]?.body).toEqual({ apiKeyId: "key_one" });
    expect(requests.at(-1)?.body).toEqual({
      loginName: "test-user",
      password: "Fixture password only",
      reason: "Credential reset",
    });
    expect(
      requests.find(
        ({ method, path }) =>
          method === "PATCH" && path.endsWith("/system/config"),
      )?.body,
    ).toEqual({
      key: "max_queue_length",
      value: 15,
      reason: "Queue policy",
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

it("previews and confirms backup retention through the admin API", async () => {
  const requests: {
    method?: string;
    path: string;
    authorization?: string | null;
    key?: string | null;
    body?: unknown;
  }[] = [];
  const retentionPath = "/admin/api/v1/backups/retention";
  const limits = { maxAgeDays: 7, maxGenerations: 2, maxTotalBytes: 0 };
  const retentionOptions = [
    "--max-age-days",
    "7",
    "--max-generations",
    "2",
    "--max-total-bytes",
    "0",
  ];
  const preview = {
    delete: ["archive.age"],
    warnings: ["PROTECTED_OVER_BYTES"],
  };
  const retentionStatus = {
    policy: null,
    candidates: limits,
    plan: { delete: [] },
  };
  let pruneFails = false;
  const origin = "https://admin.example.test";
  // Run the real CLI in an isolated worker with an in-memory HTTP fixture.
  const fixture = `
    import { parentPort, workerData } from "node:worker_threads";
    const { cli, args } = workerData;
    process.argv = [process.execPath, cli, ...args];
    globalThis.fetch = (url, options) => {
      const headers = new Headers(options.headers);
      const { pathname, search } = url;
      const { method, body } = options;
      parentPort.postMessage({
        method, path: pathname + search,
        authorization: headers.get("authorization"),
        key: headers.get("idempotency-key"),
        body: body === undefined ? undefined : JSON.parse(body),
      });
      const retentionPath = ${JSON.stringify(retentionPath)};
      let value = { fixture: true };
      if (pathname === retentionPath) {
        value = method === "POST"
          ? { policy: ${JSON.stringify(limits)}, prune: { status: workerData.pruneStatus } }
          : { ...${JSON.stringify(retentionStatus)}, proposedPlan: search ? ${JSON.stringify(preview)} : null };
      }
      return Promise.resolve(Response.json(value));
    };
    await import(cli);
  `;
  const fixtureUrl = new URL(
    "data:text/javascript," + encodeURIComponent(fixture),
  );
  const cliUrl = new URL("../apps/admin-cli/src/index.ts", import.meta.url)
    .href;
  const cli = (args: string[], lang = "C.UTF-8") =>
    new Promise<{ code: number; stdout: string; stderr: string }>(
      (resolve, reject) => {
        const worker = new Worker(fixtureUrl, {
          execArgv: ["--import", "tsx"],
          workerData: {
            cli: cliUrl,
            args,
            pruneStatus: pruneFails ? "failed" : "succeeded",
          },
          env: {
            ...process.env,
            LANGUAGE: "",
            LC_ALL: lang,
            LATEX_RENDER_BASE_URL: origin,
            LATEX_RENDER_TRUSTED_ADMIN_ORIGINS: origin,
            LATEX_RENDER_ADMIN_API_KEY: "fixture-key",
            CF_ACCESS_CLIENT_ID: "",
            CF_ACCESS_CLIENT_SECRET: "",
          },
          stdout: true,
          stderr: true,
        });
        let stdout = "";
        let stderr = "";
        worker.stdout.setEncoding("utf8").on("data", (chunk: string) => {
          stdout += chunk;
        });
        worker.stderr.setEncoding("utf8").on("data", (chunk: string) => {
          stderr += chunk;
        });
        worker.on("message", (request: (typeof requests)[number]) =>
          requests.push(request),
        );
        worker.once("error", reject);
        worker.once("exit", (code) => resolve({ code, stdout, stderr }));
      },
    );
  const base = ["backup", "retention"];
  const set = [...base, "set", ...retentionOptions, "--reason", "Disk budget"];
  const { stdout: current } = await cli(base);
  expect(JSON.parse(current)).toEqual({
    ...retentionStatus,
    proposedPlan: null,
  });
  const { stdout: proposed } = await cli([
    ...base,
    ...retentionOptions,
    "--json",
  ]);
  expect(JSON.parse(proposed)).toEqual({
    ...retentionStatus,
    proposedPlan: preview,
  });
  const { stdout: confirmation } = await cli([...set, "--yes"]);
  expect(JSON.parse(confirmation)).toEqual({
    policy: limits,
    prune: { status: "succeeded" },
  });
  expect(
    requests
      .slice(-3)
      .map(({ method, path, body }) => ({ method, path, body })),
  ).toEqual([
    { method: "GET", path: retentionPath, body: undefined },
    {
      method: "GET",
      path: retentionPath + "?maxAgeDays=7&maxGenerations=2&maxTotalBytes=0",
      body: undefined,
    },
    {
      method: "POST",
      path: retentionPath,
      body: { ...limits, reason: "Disk budget" },
    },
  ]);

  const requestCount = requests.length;
  await expect(cli(set)).resolves.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("--yes") as unknown,
  });
  await expect(cli([...base, "--max-age-days", "7"])).resolves.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("Specify all three limits") as unknown,
  });
  expect(requests).toHaveLength(requestCount);

  const { stdout: help } = await cli(["backup", "--help"], "ja_JP.UTF-8");
  expect(help).toContain("retention");
  expect(help).toContain("ローカルバックアップの保持設定を表示・プレビュー");

  pruneFails = true;
  await expect(cli([...set, "--yes"])).resolves.toMatchObject({
    code: 1,
    stdout: expect.stringContaining('"status": "failed"') as unknown,
    stderr: expect.stringContaining(
      "Retention policy saved. Pruning failed.",
    ) as unknown,
  });
}, 30_000);
