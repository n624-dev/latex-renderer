import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const script = resolve("deploy/scripts/run-image-refresh.mjs");

async function runRefresh(status: number, code: string, drift = false) {
  const root = await mkdtemp(join(tmpdir(), "image-refresh-defer-"));
  const tokenFile = join(root, "token");
  await writeFile(tokenFile, "x".repeat(32));
  let posts = 0;
  const server = createServer((request, response) => {
    request.resume();
    response.setHeader("Content-Type", "application/json");
    if (request.method === "GET" && request.url === "/v1/state") {
      response.end(
        JSON.stringify({
          desired: drift
            ? { autoUpdate: true, selector: { mode: "latest" }, languages: ["english"] }
            : { autoUpdate: false },
          current: drift ? { selector: { mode: "dated" }, languages: [] } : null,
        }),
      );
    } else if (
      request.method === "POST" &&
      request.url === (drift ? "/v1/apply" : "/v1/refresh")
    ) {
      posts += 1;
      response.statusCode = status;
      response.end(
        status === 200
          ? JSON.stringify({ id: "imgop_test" })
          : JSON.stringify({ error: { code, message: "busy fixture" } }),
      );
    } else if (request.method === "GET" && request.url === "/v1/operations/imgop_test") {
      response.end(JSON.stringify({ status: "succeeded" }));
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: { code: "NOT_FOUND" } }));
    }
  });
  server.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    try {
      const { stdout, stderr } = await execFileAsync(process.execPath, [script], {
        env: {
          ...process.env,
          IMAGE_MANAGER_URL: `http://127.0.0.1:${address.port}`,
          IMAGE_MANAGER_TOKEN_FILE: tokenFile,
        },
        timeout: 5_000,
      });
      return { exitCode: 0, stdout, stderr, posts };
    } catch (error) {
      const failure = error as Error & {
        code?: number;
        stdout?: string;
        stderr?: string;
      };
      return {
        exitCode: failure.code,
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? "",
        posts,
      };
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await rm(root, { recursive: true, force: true });
  }
}

describe("scheduled Image Manager refresh", () => {
  it.each([
    [409, "MUTATION_LOCK_BUSY"],
    [409, "IMAGE_OPERATION_ACTIVE"],
    [503, "IMAGE_MANAGER_QUIESCING"],
  ] as const)("defers expected concurrent mutation (%i %s)", async (status, code) => {
    const result = await runRefresh(status, code);
    expect(result.exitCode).toBe(0);
    expect(result.posts).toBe(1);
    expect(result.stdout).toContain('"event":"image_refresh.deferred"');
    expect(result.stdout).toContain(`"code":"${code}"`);
  });

  it("defers the drift-rebuild path while the application mutation lock is held", async () => {
    const result = await runRefresh(409, "MUTATION_LOCK_BUSY", true);
    expect(result.exitCode).toBe(0);
    expect(result.posts).toBe(1);
    expect(result.stdout).toContain('"event":"image_refresh.deferred"');
  });

  it.each([
    [409, "UNEXPECTED_CONFLICT"],
    [500, "MUTATION_LOCK_BUSY"],
  ] as const)("does not hide unexpected API failure (%i %s)", async (status, code) => {
    const result = await runRefresh(status, code);
    expect(result.exitCode).not.toBe(0);
    expect(result.posts).toBe(1);
    expect(result.stdout).not.toContain("image_refresh.deferred");
    expect(result.stderr).toContain("busy fixture");
  });

  it("still waits for and verifies an accepted operation", async () => {
    const result = await runRefresh(200, "");
    expect(result.exitCode).toBe(0);
    expect(result.posts).toBe(1);
    expect(result.stdout).toContain('"status":"succeeded"');
  });
});
