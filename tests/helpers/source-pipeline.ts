import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { ApiKeyService } from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import { TicketService } from "@latex-renderer/ticket";
import { DEFAULT_RESOURCE_LIMITS } from "@latex-renderer/shared";
import { RendererClient } from "../../packages/api-client/src/index.js";
import { RemoteRenderService } from "../../packages/remote-mcp-core/src/index.js";
import {
  gatewayRoute,
  proxyGatewayJson,
} from "../../packages/gateway-core/src/index.js";
import { createInternalApp } from "../../apps/internal-api/src/app.js";
import { createRendererApp } from "../../apps/renderer-api/src/app.js";
import { processJob } from "../../apps/renderer-worker/src/job-processor.js";
import type { WorkerConfig } from "../../apps/renderer-worker/src/config.js";
import * as docker from "../../apps/renderer-worker/src/docker.js";

export const realPipelineImage = process.env.SOURCE_PIPELINE_RENDERER_IMAGE;
if (
  realPipelineImage !== undefined &&
  !/^sha256:[a-f0-9]{64}$/.test(realPipelineImage)
)
  throw new Error("Source pipeline E2E requires an immutable local image ID");

export function pipelineDocument(pages = 1, text = "Pipeline") {
  return `% pipeline-pages: ${pages}\n\\documentclass{article}\n\\begin{document}\n${Array.from({ length: pages }, () => text).join("\\newpage\n")}\n\\end{document}\n`;
}

// Three independent loopback HTTP listeners; no global fetch or service mocks.
// Only the Docker child boundary is replaced in ordinary (no-image) tests.
export async function sourcePipelineFixture() {
  const root = await mkdtemp(join(tmpdir(), "source-pipeline-"));
  const gatePath = join(root, "renderer-gate");
  const database = await createFixtureDatabase(root);
  const servers: Server[] = [],
    children: ChildProcess[] = [];
  const containers = new Map<ChildProcess, string>();
  let run: Promise<void> | undefined;
  let restoreSpawn = () => {};
  const close = async () => {
    for (const child of children) {
      child.stdin?.end();
      if (child.exitCode === null && child.signalCode === null) {
        const name = containers.get(child);
        if (name !== undefined) await docker.dockerStop(name);
        child.kill();
      }
    }
    await run?.catch(() => undefined);
    restoreSpawn();
    const stopped = await Promise.allSettled(
      servers.map(
        (server) =>
          new Promise<void>((done, reject) => {
            if (!server.listening) {
              done();
              return;
            }
            server.close((error) => (error ? reject(error) : done()));
            server.closeAllConnections();
          }),
      ),
    );
    database.close();
    await rm(root, { recursive: true, force: true });
    const failures = stopped.filter((result) => result.status === "rejected");
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason as unknown),
        "Fixture HTTP cleanup failed",
      );
  };
  try {
    database.migrate();
    const storage = join(root, "storage");
    await mkdir(storage);
    const timestamp = new Date().toISOString();
    for (const user of ["pipeline_user", "pipeline_other"])
      database.users.insertInvitation({
        id: user,
        displayName: user,
        role: "user",
        createdBy: "fixture",
        timestamp,
      });
    const apiKeys = new ApiKeyService(
      database,
      new Map([["v1", Buffer.alloc(32, 7)]]),
      "v1",
    );
    const tokens = ["pipeline_user", "pipeline_user", "pipeline_other"].map(
      (user, index) => {
        const account = `pipeline_account_${index}`,
          key = apiKeys.create("render");
        database.serviceAccounts.insert({
          id: account,
          ownerUserId: user,
          name: account,
          clientType: "generic",
          timestamp,
        });
        database.apiKeys.insert({
          id: key.id,
          serviceAccountId: account,
          name: account,
          prefix: key.prefix,
          kind: key.kind,
          secretHash: key.secretHash,
          pepperId: key.pepperId,
          scopes: ["render:create", "render:read:own"],
          createdAt: timestamp,
          createdBy: "fixture",
        });
        return key.token;
      },
    );
    const tickets = new TicketService(
      database,
      "latex-renderer",
      "latex-render",
      { kid: "v1", secret: Buffer.alloc(32, 9) },
      [],
    );
    const requests: Array<{ method: string; path: string }> = [];
    const http = async (
      fetcher: (request: Request) => Promise<Response> | Response,
    ) => {
      const server = createServer((incoming, outgoing) => {
        void (async () => {
          const address = server.address();
          assert.ok(address && typeof address !== "string");
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers))
            if (value !== undefined)
              headers.set(
                name,
                Array.isArray(value) ? value.join(", ") : value,
              );
          const method = incoming.method ?? "GET";
          const init: RequestInit & { duplex: "half" } = {
            method,
            headers,
            duplex: "half",
          };
          if (method !== "GET" && method !== "HEAD")
            init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
          const request = new Request(
            `http://127.0.0.1:${address.port}${incoming.url}`,
            init,
          );
          const response = await fetcher(request);
          outgoing.writeHead(
            response.status,
            Object.fromEntries(response.headers),
          );
          if (response.body)
            await pipeline(
              Readable.fromWeb(
                response.body as Parameters<typeof Readable.fromWeb>[0],
              ),
              outgoing,
            );
          else outgoing.end();
        })().catch((error: unknown) =>
          outgoing.destroy(
            error instanceof Error ? error : new Error("Fixture HTTP error"),
          ),
        );
      });
      servers.push(server);
      await new Promise<void>((done, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", done);
      });
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      return `http://127.0.0.1:${address.port}`;
    };
    const renderer = createRendererApp({
      database,
      tickets,
      storageRoot: storage,
      ...DEFAULT_RESOURCE_LIMITS,
      minFreeStorageBytes: 0,
      artifactRetentionHours: 24,
    });
    const rendererOrigin = await http((request) => {
      requests.push({
        method: request.method,
        path: new URL(request.url).pathname,
      });
      return renderer.fetch(request);
    });
    const internal = createInternalApp({
      database,
      apiKeys,
      tickets,
      rendererPublicUrl: rendererOrigin,
      rendererVersion: "pipeline-test",
      maxUploadBytes: DEFAULT_RESOURCE_LIMITS.maxUploadBytes,
      maxOutputBytes: 1024 * 1024,
      maxQueueLength: 20,
      maxUserStorageBytes: 20 * 1024 * 1024,
    });
    const internalOrigin = await http((request) => internal.fetch(request));
    const origin = await http((request) => {
      const url = new URL(request.url),
        path = url.pathname;
      requests.push({ method: request.method, path });
      const route = gatewayRoute(path, request.method);
      // The real public ingress sends large transfers/status straight to the
      // Renderer API; only small JSON requests use the shared gateway core.
      if (route === undefined)
        return fetch(
          new Request(new URL(path + url.search, rendererOrigin), request),
          {
            redirect: "error",
          },
        );
      if (typeof route === "string")
        return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
      return proxyGatewayJson({
        request,
        requestId: "pipeline-test",
        upstreamPath: route.upstreamPath,
        idempotencyRequired: route.idempotencyRequired,
        bodyRequired: route.bodyRequired,
        fetchUpstream: (url, init) =>
          fetch(new URL(url.pathname + url.search, internalOrigin), init),
      });
    });
    const clients = tokens.map(
      (token) =>
        new RendererClient(origin, token, {
          trustedRendererOrigins: [rendererOrigin],
        }),
    );
    const [client, sibling, outsider] = clients;
    assert.ok(client && sibling && outsider);
    const config: WorkerConfig = {
      ...DEFAULT_RESOURCE_LIMITS,
      databasePath: join(root, "test.sqlite3"),
      storageRoot: storage,
      image: realPipelineImage ?? `sha256:${"0".repeat(64)}`,
      workerId: "pipeline_worker",
      seccompProfile: resolve("deploy/security/seccomp.json"),
      apparmorProfile: undefined,
      maxOutputBytes: 1024 * 1024,
      maxOutputFileCount: 100,
      maxOutputDirectoryCount: 20,
      maxLogBytes: 256 * 1024,
      maxSvgObjects: 20,
      maxSvgBytes: 256 * 1024,
      maxSvgTotalBytes: 1024 * 1024,
      svgConversionTimeoutSeconds: 60,
      containerUid: process.getuid?.() || 10_000,
      containerGid: process.getgid?.() || 10_000,
      jobTimeoutMs: 90_000,
    };
    let holdNext = false;
    let resolveSpawn: (() => void) | undefined;
    const originalSpawn = docker.spawnRenderer;
    const spawnSpy = vi
      .spyOn(docker, "spawnRenderer")
      .mockImplementation(
        (cfg, id, generation, input, staging, entrypoint, outputs) => {
          const result =
            realPipelineImage !== undefined
              ? originalSpawn(
                  cfg,
                  id,
                  generation,
                  input,
                  staging,
                  entrypoint,
                  outputs,
                )
              : {
                  containerName: "pipeline-fixture",
                  process: spawn(
                    process.execPath,
                    [
                      fileURLToPath(
                        new URL(
                          "../fixtures/source-pipeline-renderer.mjs",
                          import.meta.url,
                        ),
                      ),
                      input,
                      staging,
                      entrypoint ?? "main.tex",
                      holdNext ? gatePath : "",
                    ],
                    { stdio: ["ignore", "pipe", "pipe"] },
                  ),
                };
          holdNext = false;
          children.push(result.process);
          if (realPipelineImage !== undefined)
            containers.set(result.process, result.containerName);
          resolveSpawn?.();
          resolveSpawn = undefined;
          return result;
        },
      );
    restoreSpawn = () => spawnSpy.mockRestore();
    const runNext = async () => {
      assert.equal(run, undefined, "Do not overlap fixture Worker claims");
      const job = database.worker.claimNext(
        config.workerId,
        new Date().toISOString(),
        new Date(Date.now() + 30_000).toISOString(),
      );
      assert.ok(job, "Client must queue a real DB Job before Worker runs");
      run = processJob(database, config, job);
      try {
        await run;
      } finally {
        run = undefined;
      }
    };
    const renders = new RemoteRenderService(
      database,
      storage,
      "pipeline-test",
      origin,
      20,
      20 * 1024 * 1024,
      join(root, "environment"),
      DEFAULT_RESOURCE_LIMITS,
      1024 * 1024,
    );
    return {
      root,
      database,
      storage,
      client,
      sibling,
      outsider,
      renders,
      requests,
      runNext,
      close,
      holdNextRenderer() {
        assert.equal(
          realPipelineImage,
          undefined,
          "Gated child applies only to deterministic fixtures",
        );
        holdNext = true;
        return new Promise<void>((done) => {
          resolveSpawn = done;
        });
      },
      async releaseRenderer() {
        await writeFile(gatePath, "continue", { mode: 0o600 });
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

async function createFixtureDatabase(root: string) {
  try {
    return new RendererDatabase(join(root, "test.sqlite3"));
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
