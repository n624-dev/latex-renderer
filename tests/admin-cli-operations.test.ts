import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import { expect, it } from "vitest";
import { listValidatedSourceFiles } from "@latex-renderer/zip-validation";
import { readFixtureBody } from "./helpers/fixture-http.js";

const run = promisify(execFile);
const cli = ["--import", "tsx", "apps/admin-cli/src/index.ts"];
const configPath = "/admin/api/v1/system/config";
const effective = [
  {
    key: "max_queue_length",
    value: 15,
    source: "database",
    fallback: 60,
    unit: "jobs",
    minimum: 1,
    maximum: 10000,
    environment: "MAX_QUEUE_LENGTH",
  },
  {
    key: "max_user_storage_bytes",
    value: 524288000,
    source: "host",
    fallback: 524288000,
    unit: "bytes",
    minimum: 104857600,
    maximum: 107374182400,
    environment: "MAX_USER_STORAGE_BYTES",
  },
  {
    key: "max_user_active_jobs",
    value: 20,
    source: "default",
    fallback: 20,
    unit: "jobs",
    minimum: 1,
    maximum: 1000,
    environment: null,
  },
] as const;
const config = {
  items: [{ key: "max_queue_length", value_json: "15" }],
  effective,
};
const afterReset = { ...effective[0], value: 60, source: "host" };

it("lists config reset in help and requires a reason and confirmation", async () => {
  const options = {
    env: { ...process.env, LC_ALL: "C.UTF-8" },
    encoding: "utf8",
  } as const;
  const { stdout } = await run(
    process.execPath,
    [...cli, "system", "config", "--help"],
    options,
  );
  expect(stdout).toContain("reset [options] <key>");
  expect(stdout).toContain("Return to host default");

  const reset = [...cli, "system", "config", "reset", "max_queue_length"];
  await expect(
    run(process.execPath, [...reset, "--yes"], options),
  ).rejects.toThrow(/required option '--reason <reason>'/);
  await expect(
    run(process.execPath, [...reset, "--reason", "Queue policy"], options),
  ).rejects.toThrow(/required option '--yes'/);
});

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
        if (request.url === configPath && request.method === "GET") {
          response.end(JSON.stringify(config));
        } else if (request.url === configPath + "/reset") {
          response.end(JSON.stringify(afterReset));
        } else {
          response.statusCode = request.method === "POST" ? 202 : 200;
          response.end('{"fixture":true}');
        }
      })
      .catch(() => response.writeHead(400).end());
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
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
      ["system", "config", "--json"],
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
        "system",
        "config",
        "reset",
        "max_queue_length",
        "--reason",
        "Restore host limit",
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
        "api-keys",
        "create",
        "--service-account",
        "account_one",
        "--name",
        "Fixture",
        "--scope",
        "render:create",
        "render:read:own",
      ],
      ["api-keys", "rotate", "key_one", "--yes"],
      ["api-keys", "revoke", "key_two", "--yes"],
      ["service-accounts", "disable", "account_one", "--yes"],
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
      const execution = run(process.execPath, [...cli, ...args], {
        timeout: 10_000,
        encoding: "utf8",
        env: {
          ...process.env,
          LC_ALL: "C.UTF-8",
          LATEX_RENDER_BASE_URL: origin,
          LATEX_RENDER_TRUSTED_ADMIN_ORIGINS: origin,
          LATEX_RENDER_ADMIN_API_KEY: "fixture-key",
          CF_ACCESS_CLIENT_ID: "",
          CF_ACCESS_CLIENT_SECRET: "",
        },
      });
      if (args.includes("--password-stdin"))
        execution.child.stdin?.end("Fixture password only\r\n");
      const { stdout } = await execution;
      expect(stdout).not.toContain("Fixture password only");
      const deleted = args[1] === "delete";
      if (args[0] === "system" && args[2] === undefined) {
        expect(stdout).toContain(
          "max_queue_length\n  Effective value: 15 jobs (Admin override) · Host default: 60 jobs",
        );
        expect(stdout).toContain("524288000 bytes (Host setting)");
        expect(stdout).toContain("20 jobs (Built-in default)");
      } else if (args[0] === "system" && args[2] === "--json") {
        expect(JSON.parse(stdout)).toEqual({
          ...config,
          effective: [
            { ...effective[0], hostDefault: 60, adminOverride: 15 },
            { ...effective[1], hostDefault: 524288000, adminOverride: null },
            { ...effective[2], hostDefault: 20, adminOverride: null },
          ],
        });
      } else if (args[0] === "system" && args[2] === "reset") {
        expect(JSON.parse(stdout)).toEqual(afterReset);
      } else {
        expect(JSON.parse(stdout)).toEqual(
          deleted
            ? args[0] === "service-accounts"
              ? { id: args[2], disabled: true }
              : { id: args[2], accepted: true }
            : { fixture: true },
        );
      }
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
      ["GET", configPath],
      ["GET", configPath],
      ["PATCH", configPath],
      ["POST", configPath + "/reset"],
      ["GET", "/admin/api/v1/audit-logs?actor=user+%2F+owner&result=failed"],
      ["POST", "/admin/api/v1/service-accounts/account_one/api-keys"],
      ["POST", "/admin/api/v1/api-keys/key_one/rotate"],
      ["POST", "/admin/api/v1/api-keys/key_two/revoke"],
      ["POST", "/admin/api/v1/service-accounts/account_one/disable"],
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
    expect(
      requests.find(({ path }) => path.endsWith("/account_one/api-keys"))?.body,
    ).toEqual({
      name: "Fixture",
      scopes: ["render:create", "render:read:own"],
    });
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
    expect(
      requests.find(
        ({ method, path }) =>
          method === "POST" && path.endsWith("/system/config/reset"),
      )?.body,
    ).toEqual({
      key: "max_queue_length",
      reason: "Restore host limit",
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

it("registers a ZIP or directory and renders through the existing Source route when requested", async () => {
  const sourceId = `source_${"a".repeat(32)}`;
  const jobId = `job_${"b".repeat(32)}`;
  const renderKey = "key_render";
  const idempotencyKey = "register-and-render-fixture";
  const registerOnlyKey = "register-only-fixture";
  const uploadTicket = "fixture-source-upload-ticket";
  const expiresAt = "2099-01-01T00:00:00Z";
  const uploads: Buffer[] = [];
  const reservations: {
    auth?: string;
    key?: string | string[];
    body: unknown;
  }[] = [];
  const renders: typeof reservations = [];
  const uploadHeaders: Record<string, unknown>[] = [];
  let origin = "";
  const server = createServer((req, res) => {
    void (async () => {
      const send = (value: unknown) =>
        res
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify(value));
      const prefix = "/admin/api/v1";
      const uploadPath = `/api/v1/sources/${sourceId}/content`;
      const { authorization: auth, "idempotency-key": key } = req.headers;
      if (req.method === "GET" && req.url === prefix + "/jobs/render-targets") {
        send({
          items: [],
          sourceLimits: {
            maxUploadBytes: 65536,
            maxExtractedBytes: 65536,
            maxFileCount: 10,
            maxZipEntries: 10,
          },
        });
      } else if (
        req.method === "POST" &&
        req.url === prefix + "/jobs/source-tickets"
      ) {
        reservations.push({
          ...(auth ? { auth } : {}),
          ...(key ? { key } : {}),
          body: JSON.parse((await readFixtureBody(req)).toString()),
        });
        send({
          sourceId,
          uploadRequired: reservations.length !== 2,
          uploadUrl: origin + uploadPath,
          uploadTicket,
          expiresAt,
        });
      } else if (req.method === "PUT" && req.url === uploadPath) {
        uploadHeaders.push(req.headers);
        uploads.push(await readFixtureBody(req));
        res.writeHead(204).end();
      } else if (
        req.method === "POST" &&
        req.url === prefix + `/sources/${sourceId}/render`
      ) {
        renders.push({
          ...(auth ? { auth } : {}),
          ...(key ? { key } : {}),
          body: JSON.parse((await readFixtureBody(req)).toString()),
        });
        send({ jobId, jobTicket: "fixture-job-ticket", expiresAt });
      } else res.writeHead(404).end();
    })().catch(() => res.writeHead(500).end());
  });
  const directory = await mkdtemp(join(tmpdir(), "admin-cli-source-"));
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing fixture port");
    origin = `http://127.0.0.1:${address.port}`;
    const folder = join(directory, "input");
    await mkdir(join(folder, "reports"), { recursive: true });
    await writeFile(join(folder, "reports", "report.tex"), "fixture");
    await writeFile(join(folder, ".latexrenderignore"), "ignored.tex\n");
    await writeFile(join(folder, "ignored.tex"), "ignored");
    const create = (input: string, ...flags: string[]) =>
      run(
        process.execPath,
        [...cli, "sources", "create", input, "--json", ...flags],
        {
          env: {
            ...process.env,
            LATEX_RENDER_BASE_URL: origin,
            LATEX_RENDER_TRUSTED_ADMIN_ORIGINS: origin,
            LATEX_RENDER_ADMIN_API_KEY: "fixture-admin-key",
            CF_ACCESS_CLIENT_ID: "fixture-access-id",
            CF_ACCESS_CLIENT_SECRET: "fixture-access-secret",
          },
          encoding: "utf8",
        },
      );
    await expect(create(folder, "--yes")).rejects.toThrow(
      /required option '--key <apiKeyId>'/,
    );
    await expect(create(folder, "--key", renderKey)).rejects.toThrow(
      /required option '--yes'/,
    );
    const flags = [
      "--key",
      renderKey,
      "--render",
      "--entrypoint",
      "reports/report.tex",
      "--svg",
      "--idempotency-key",
      idempotencyKey,
      "--yes",
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
      const rendered = await create(folder, ...flags);
      expect(JSON.parse(rendered.stdout)).toEqual({ sourceId, jobId });
    }
    const uploaded = uploads[0];
    if (!uploaded) throw new Error("Missing Source upload");
    const zipPath = join(directory, "input.zip");
    await writeFile(zipPath, uploaded);
    const files = await listValidatedSourceFiles(zipPath, {
      maxExtractedBytes: 65536,
      maxFileBytes: 65536,
      maxEntries: 10,
      maxFiles: 10,
      maxDepth: 10,
      maxNameLength: 200,
    });
    expect(files.map(({ path }) => path)).toEqual(["reports/report.tex"]);

    const registered = await create(
      zipPath,
      "--key",
      renderKey,
      "--yes",
      "--idempotency-key",
      registerOnlyKey,
    );
    expect(JSON.parse(registered.stdout)).toEqual({ sourceId });
    const identity = { auth: "Bearer fixture-admin-key", key: idempotencyKey };
    const metadata = {
      size: uploaded.length,
      sha256: createHash("sha256").update(uploaded).digest("hex"),
    };
    expect(reservations).toEqual([
      ...Array.from({ length: 2 }, () => ({
        ...identity,
        body: { apiKeyId: renderKey, ...metadata },
      })),
      {
        ...identity,
        key: registerOnlyKey,
        body: { apiKeyId: renderKey, ...metadata },
      },
    ]);
    expect(renders).toEqual(
      Array.from({ length: 2 }, () => ({
        ...identity,
        body: {
          apiKeyId: renderKey,
          entrypoint: "reports/report.tex",
          outputs: ["pdf", "svg"],
        },
      })),
    );
    expect(uploads).toEqual([uploaded, uploaded]);
    for (const headers of uploadHeaders) {
      expect(headers).toMatchObject({
        authorization: `Bearer ${uploadTicket}`,
        "content-type": "application/zip",
      });
      expect(headers).not.toHaveProperty("cf-access-client-id");
      expect(headers).not.toHaveProperty("cf-access-client-secret");
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
