import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { readFixtureBody } from "./helpers/fixture-http.js";

const run = promisify(execFile);

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
    ]) {
      const { stdout } = await run(
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
      expect(JSON.parse(stdout)).toEqual({ fixture: true });
    }
    expect(requests.map(({ method, path }) => [method, path])).toEqual([
      [
        "GET",
        "/admin/api/v1/jobs?status=failed&pageSize=15&cursor=previous+result",
      ],
      ["POST", "/admin/api/v1/jobs/job_test/retry-svg"],
      ["POST", "/admin/api/v1/backups/create"],
      ["GET", "/admin/api/v1/system/config"],
      ["PATCH", "/admin/api/v1/system/config"],
      ["GET", "/admin/api/v1/audit-logs?actor=user+%2F+owner&result=failed"],
    ]);
    expect(
      requests.every(
        ({ authorization }) => authorization === "Bearer fixture-key",
      ),
    ).toBe(true);
    expect(requests[1]?.key).toMatch(/^[a-f0-9-]{36}$/);
    expect(requests[4]?.body).toEqual({
      key: "max_queue_length",
      value: 15,
      reason: "Queue policy",
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
