import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { createUserSchema } from "@latex-renderer/contracts";
import { readFixtureBody } from "./helpers/fixture-http.js";

async function run(
  args: string[],
  input = "",
  access: "none" | "pair" | "partial" = "none",
) {
  const received: Array<{
    body: unknown;
    id: string | undefined;
    secret: string | undefined;
  }> = [];
  const server = createServer((request, response) => {
    void readFixtureBody(request)
      .then((bytes) => {
        const body: unknown = JSON.parse(bytes.toString("utf8"));
        const parsed = createUserSchema.safeParse(body);
        received.push({
          body,
          id: request.headers["cf-access-client-id"] as string | undefined,
          secret: request.headers["cf-access-client-secret"] as
            string | undefined,
        });
        response
          .writeHead(parsed.success ? 201 : 400, {
            "Content-Type": "application/json",
          })
          .end(
            parsed.success
              ? '{"id":"fixture-user"}'
              : '{"error":{"code":"INVALID_INPUT"}}',
          );
      })
      .catch(() => {
        response.writeHead(500).end("{}");
      });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture address");
  const origin = `http://127.0.0.1:${address.port}`;
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "apps/admin-cli/src/index.ts",
      "users",
      "create",
      ...args,
    ],
    {
      env: {
        ...process.env,
        LATEX_RENDER_BASE_URL: origin,
        LATEX_RENDER_TRUSTED_ADMIN_ORIGINS: origin,
        LATEX_RENDER_ADMIN_API_KEY: "fixture-admin-key",
        CF_ACCESS_CLIENT_ID: access === "none" ? "" : "fixture-id",
        CF_ACCESS_CLIENT_SECRET: access === "pair" ? "fixture-secret" : "",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stdout = "",
    stderr = "";
  child.stdout.setEncoding("utf8").on("data", (s: string) => {
    stdout += s;
  });
  child.stderr.setEncoding("utf8").on("data", (s: string) => {
    stderr += s;
  });
  child.stdin.on("error", () => {});
  child.stdin.end(input);
  const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
  try {
    const status = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    return { status, stdout, stderr, received };
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
const common = ["--display-name", "Fixture owner", "--role", "user"];
describe("Admin CLI native and external user contract", () => {
  it("creates password users on Standalone without Cloudflare fields or plaintext argv", async () => {
    const password = "fixture password with spaces ",
      result = await run(
        [
          ...common,
          "--authentication",
          "password",
          "--login-name",
          "fixture-user",
          "--password-stdin",
        ],
        password + "\n",
      );
    expect(result.status, result.stderr).toBe(0);
    expect(result.received).toEqual([
      {
        body: {
          displayName: "Fixture owner",
          role: "user",
          authentication: {
            type: "password",
            loginName: "fixture-user",
            password,
          },
        },
        id: undefined,
        secret: undefined,
      },
    ]);
    expect(result.stdout + result.stderr).not.toContain(password);
  });
  it.each(["none", "pair"] as const)(
    "creates external users and sends only a complete optional Access pair: %s",
    async (access) => {
      const result = await run(
        [
          ...common,
          "--authentication",
          "external",
          "--subject",
          "fixture-subject",
          "--preferred-username",
          "fixture-name",
          "--email-at-provider",
          "fixture@example.test",
        ],
        "",
        access,
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.received[0]?.body).toEqual({
        displayName: "Fixture owner",
        role: "user",
        authentication: {
          type: "external",
          subject: "fixture-subject",
          preferredUsername: "fixture-name",
          emailAtProvider: "fixture@example.test",
        },
      });
      expect(result.received[0]?.id).toBe(
        access === "pair" ? "fixture-id" : undefined,
      );
    },
  );
  it("rejects partial Access settings before an HTTP write", async () => {
    const result = await run(
      [...common, "--authentication", "external", "--subject", "fixture"],
      "",
      "partial",
    );
    expect(result.status).toBe(1);
    expect(result.received).toEqual([]);
    expect(result.stderr).toContain("Configure both");
  });
  it.each([
    ["--authentication", "password", "--login-name", "fixture"],
    [
      "--authentication",
      "external",
      "--subject",
      "fixture",
      "--password-stdin",
    ],
    ["--authentication", "unknown"],
  ])(
    "rejects incoherent authentication options before HTTP: %j",
    async (args) => {
      const result = await run([...common, ...args]);
      expect(result.status).toBe(1);
      expect(result.received).toEqual([]);
    },
  );
  it("bounds stdin without echoing credentials or sending a reservation", async () => {
    const result = await run(
      [
        ...common,
        "--authentication",
        "password",
        "--login-name",
        "fixture",
        "--password-stdin",
      ],
      "x".repeat(8193),
    );
    expect(result.status).toBe(1);
    expect(result.received).toEqual([]);
    expect(result.stderr).toContain("size limit");
    expect(result.stderr).not.toContain("x".repeat(32));
  });
});
