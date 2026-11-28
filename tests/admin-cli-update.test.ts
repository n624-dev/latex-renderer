import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { readFixtureBody } from "./helpers/fixture-http.js";

const id = "updop_1700000000000_fixture";
const outcome = (updater: string, complete = false) => ({
  id,
  status: "succeeded",
  outcome: { application: "succeeded", updater, complete },
});

async function run(
  command: string,
  replies: unknown[],
  failure?: { status: number; code: string; message: string },
) {
  const requests: Array<{ method: string; path: string; body: string }> = [];
  let read = 0;
  const server = createServer((request, response) => {
    void readFixtureBody(request)
      .then((body) => {
        requests.push({
          method: request.method ?? "UNKNOWN",
          path: request.url ?? "/",
          body: body.toString(),
        });
        response.setHeader("Content-Type", "application/json");
        if (
          request.method === "POST" &&
          request.url === `/admin/api/v1/updates/${command}`
        ) {
          if (failure) {
            const { status, code, message } = failure;
            response
              .writeHead(status)
              .end(JSON.stringify({ error: { code, message } }));
          } else response.end(JSON.stringify({ id, status: "running" }));
        } else if (
          request.method === "GET" &&
          request.url === "/admin/api/v1/updates/state"
        )
          response.end(JSON.stringify(replies[0]));
        else if (
          request.method === "GET" &&
          request.url === `/admin/api/v1/updates/operations/${id}`
        )
          response.end(
            JSON.stringify(replies[Math.min(read++, replies.length - 1)]),
          );
        else response.writeHead(404).end("{}");
      })
      .catch(() => {
        response.writeHead(500).end("{}");
      });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing listener");
  const origin = `http://127.0.0.1:${address.port}`;
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("../apps/admin-cli/src/index.ts", import.meta.url)),
      "update",
      command,
      ...(command === "apply" ? ["7.8.9-rc.4"] : []),
      ...(command === "policy" ? ["--mode", "notify"] : []),
      ...(command === "status"
        ? []
        : ["--reason", "Fixture deployment", "--yes"]),
    ],
    {
      env: {
        ...process.env,
        LATEX_RENDER_BASE_URL: origin,
        LATEX_RENDER_TRUSTED_ADMIN_ORIGINS: origin,
        LATEX_RENDER_ADMIN_API_KEY: "fixture",
        CF_ACCESS_CLIENT_ID: "fixture",
        CF_ACCESS_CLIENT_SECRET: "fixture",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "",
    stderr = "";
  child.stdout.setEncoding("utf8").on("data", (value: string) => {
    stdout += value;
  });
  child.stderr.setEncoding("utf8").on("data", (value: string) => {
    stderr += value;
  });
  const timeout = setTimeout(() => child.kill(), 20_000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    return { code, stdout, stderr, requests };
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null) child.kill();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

it.each(["apply", "rollback"])(
  "%s waits for the complete outcome and never repeats the POST",
  async (command) => {
    const result = await run(command, [
      outcome("activating"),
      outcome("succeeded", true),
    ]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout) as unknown).toMatchObject({
      id,
      outcome: { complete: true },
    });
    expect(
      result.requests.filter((request) => request.method === "POST"),
    ).toHaveLength(1);
    expect(
      result.requests.filter((request) => request.method === "GET"),
    ).toHaveLength(2);
    expect(result.stderr).toContain("Updater activating");
    expect(result.stderr).toContain(id);
  },
);

it.each([
  outcome("needs-attention"),
  { id, status: "succeeded" },
  { ...outcome("succeeded", true), id: "updop_other" },
])(
  "exits nonzero for an unconfirmed activation without reapplying (%j)",
  async (reply) => {
    const result = await run("apply", [reply]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("unconfirmed");
    expect(result.stderr).toContain(`update operation ${id}`);
    expect(result.requests).toHaveLength(2);
  },
);

it("preserves terminal application failure and its nonzero exit", async () => {
  const result = await run("apply", [
    { id, status: "failed", error: "Fixture deployment failed" },
  ]);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout) as unknown).toMatchObject({
    status: "failed",
  });
  expect(result.stderr).toContain("Fixture deployment failed");
  expect(result.requests).toHaveLength(2);
});

it.each([
  {
    status: 409,
    code: "UPDATE_OPERATION_ACTIVE",
    message: "Update policy cannot change while an operation is running",
  },
  { status: 500, code: "ENOENT", message: "Update state rename failed" },
])(
  "reports the $code policy error and reads the last confirmed policy",
  async (failure) => {
    const rejected = await run("policy", [], failure);
    expect(rejected.code).toBe(1);
    expect(rejected.stdout).toBe("");
    expect(rejected.stderr).toContain(failure.message);
    expect(rejected.requests).toHaveLength(1);
    expect(JSON.parse(rejected.requests[0]?.body ?? "")).toEqual({
      channel: "stable",
      mode: "notify",
      reason: "Fixture deployment",
    });

    const persisted = {
      policy: { channel: "stable", mode: "automatic" },
      lastOperationId: id,
    };
    const status = await run("status", [persisted]);
    expect(status.code).toBe(0);
    expect(JSON.parse(status.stdout)).toEqual(persisted);
    expect(status.requests).toEqual([
      { method: "GET", path: "/admin/api/v1/updates/state", body: "" },
    ]);
  },
);
