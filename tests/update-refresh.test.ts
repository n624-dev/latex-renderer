import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const operationId = "updop_fixture";
const token = "fixture-credential-not-for-production";

async function withManager(
  responses: readonly (Record<string, unknown> | null)[],
  exercise: (
    execute: () => Promise<{ stdout: string; stderr: string }>,
    requests: string[],
  ) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "refresh-test-"));
  const socketPath = join(root, "manager.sock");
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401).end("{}");
      return;
    }
    const state = responses[requests.length - 1];
    if (state === null) request.socket.destroy();
    else if (state === undefined) response.writeHead(500).end("{}");
    else response.writeHead(200).end(JSON.stringify(state));
  });
  try {
    server.listen(socketPath);
    await once(server, "listening");
    await exercise(
      () =>
        run(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `import { runUpdateRefresh } from "./deploy/scripts/run-update-refresh.mjs";
       await runUpdateRefresh(JSON.parse(process.argv[1]));`,
            JSON.stringify({
              socketPath,
              token,
              maximumWaitMs: 5_000,
              pollMs: 10,
            }),
          ],
          { encoding: "utf8", timeout: 8_000 },
        ),
      requests,
    );
  } finally {
    server.closeAllConnections();
    try {
      if (server.listening) {
        const closed = once(server, "close");
        server.close();
        await closed;
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

describe.skipIf(process.platform === "win32")(
  "systemd application refresh process",
  () => {
    const accepted = { status: "started", operation: { id: operationId } };
    const check = `GET /v1/operations/${operationId}?includeLog=0`;

    it("follows the accepted update through a connection loss and waits for Updater activation", async () => {
      await withManager(
        [
          accepted,
          { id: operationId, status: "running" },
          null,
          {
            id: operationId,
            status: "succeeded",
            outcome: { complete: false },
          },
          { id: operationId, status: "succeeded", outcome: { complete: true } },
        ],
        async (execute, requests) => {
          const { stdout } = await execute();
          expect(requests).toEqual([
            "POST /v1/refresh",
            check,
            check,
            check,
            check,
          ]);
          expect(
            stdout
              .trim()
              .split("\n")
              .map((line) => JSON.parse(line)),
          ).toEqual([
            { event: "application_update.started", operationId },
            { event: "application_update.reconnecting", operationId },
            { event: "application_update.completed", operationId },
          ]);
        },
      );
    }, 10_000);

    it("exits nonzero when an accepted update later fails", async () => {
      await withManager(
        [
          accepted,
          { id: operationId, status: "running" },
          { id: operationId, status: "failed" },
        ],
        async (execute, requests) => {
          await expect(execute()).rejects.toMatchObject({
            code: 1,
            stderr: expect.stringContaining(
              `Automatic application update ${operationId} failed`,
            ),
          });
          expect(requests).toEqual(["POST /v1/refresh", check, check]);
        },
      );
    }, 10_000);

    it("identifies a check with no pending update and exits without polling", async () => {
      await withManager(
        [{ status: "up-to-date" }],
        async (execute, requests) => {
          const { stdout } = await execute();
          expect(JSON.parse(stdout)).toEqual({
            event: "application_update.refresh",
            status: "up-to-date",
          });
          expect(requests).toEqual(["POST /v1/refresh"]);
        },
      );
    }, 10_000);
  },
);
