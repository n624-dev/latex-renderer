import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
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
    expect(requests[6]?.body).toEqual({
      key: "max_queue_length",
      reason: "Restore host limit",
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);
