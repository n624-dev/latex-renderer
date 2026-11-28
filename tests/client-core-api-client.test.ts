import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobResponse } from "@latex-renderer/contracts";
import { AppError } from "@latex-renderer/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RendererClient } from "../packages/api-client/src/index.js";
import {
  acceptedJobRecovery,
  renderProject,
  renderSource,
  withClientOperationDeadline,
  type ClientCoreEvent,
} from "../packages/client-core/src/index.js";

const wireSourceId = `source_${"c".repeat(32)}`;
const wireJobId = `job_${"b".repeat(32)}`;
const wireTicket = "initial-job-ticket-fixture";
const wireJob = `GET /api/v1/jobs/${wireJobId}`;
const wireRenew = `POST /api/v1/job-tickets/${wireJobId}`;
const wireLog = `${wireJob}/artifacts/compile.log`;
const wireSvg = "svg/objects/math-000001.svg";
const wireArtifactFiles = new Map([
  [`${wireJob}/artifacts/result.pdf`, "result.pdf"],
  [wireLog, "compile.log"],
  [`${wireJob}/previews/page-1.png`, "page-1.png"],
  [`${wireJob}/artifacts/${wireSvg}`, wireSvg],
]);

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("client core", () => {
  it("renews on expiry between PDF, log, PNG and SVG using the HTTP client", async () => {
    const root = await temporaryRoot();
    let now = Date.now();
    const expiresAt = () => new Date(now + 120_000).toISOString();
    const reads: [string, string | null][] = [];
    let renewals = 0;
    const client = renderWire((route, init) => {
      if (route === "POST /api/v1/render-tickets")
        return Response.json({
          jobId: wireJobId,
          jobTicket: wireTicket,
          expiresAt: expiresAt(),
        });
      if (route === wireRenew)
        return Response.json({
          jobTicket: `renewed-ticket-${++renewals}`,
          expiresAt: expiresAt(),
        });
      const file = wireArtifactFiles.get(route);
      if (file === undefined) return;
      reads.push([file, new Headers(init?.headers).get("Authorization")]);
      now += 120_001;
      return new Response(file);
    });
    const result = await renderSource(client, wireSourceId, {
      now: () => now,
      outputDirectory: root,
    });

    expect(reads).toEqual([
      ["result.pdf", `Bearer ${wireTicket}`],
      ["compile.log", "Bearer renewed-ticket-1"],
      ["page-1.png", "Bearer renewed-ticket-2"],
      [wireSvg, "Bearer renewed-ticket-3"],
    ]);
    expect(renewals).toBe(3);
    for (const file of [
      "result.pdf",
      "compile.log",
      "previews/page-1.png",
      wireSvg,
    ])
      expect(await readFile(join(root, file), "utf8")).toBe(
        file.replace(/^previews\//, ""),
      );
    expect(result.job.id).toBe(wireJobId);
  });

  it.each([
    ["renewal failure", "HTTP_ERROR", 1, 1],
    ["revocation", "TICKET_REVOKED", 1, 0],
    ["still expired after renewal", "INVALID_TICKET", 2, 1],
  ] as const)(
    "stops artifact retrieval on %s and keeps the previous generation",
    async (scenario, code, logReads, renewalCount) => {
      const root = await temporaryRoot();
      await writeFile(join(root, "result.pdf"), "previous PDF");
      await writeFile(join(root, "job.json"), "previous Job");
      const requests: string[] = [];
      const fetcher = renderWire((route) => {
        requests.push(route);
        if (route === wireRenew)
          return scenario === "renewal failure"
            ? Response.json({}, { status: 503 })
            : Response.json({
                jobTicket: "renewed-ticket-fixture",
                expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
              });
        if (route !== wireLog) return;
        return Response.json(
          {
            error: {
              code:
                scenario === "revocation" ? "TICKET_REVOKED" : "INVALID_TICKET",
              message: "Artifact ticket rejected",
            },
          },
          { status: 401 },
        );
      });
      const events: ClientCoreEvent[] = [];
      await expect(
        renderSource(fetcher, wireSourceId, {
          outputDirectory: root,
          onEvent: (event) => events.push(event),
        }),
      ).rejects.toMatchObject({
        code,
        details: { jobId: wireJobId, lastStatus: "succeeded" },
      });
      expect(requests.filter((route) => route === wireRenew)).toHaveLength(
        renewalCount,
      );
      expect(requests.filter((route) => route === wireLog)).toHaveLength(
        logReads,
      );
      expect(requests.filter((route) => wireArtifactFiles.has(route))).toEqual([
        `${wireJob}/artifacts/result.pdf`,
        ...Array<string>(logReads).fill(wireLog),
      ]);
      expect(events.some(({ type }) => type === "artifact.downloaded")).toBe(
        false,
      );
      expect(await readdir(root)).toEqual(["job.json", "result.pdf"]);
      expect(await readFile(join(root, "result.pdf"), "utf8")).toBe(
        "previous PDF",
      );
      expect(await readFile(join(root, "job.json"), "utf8")).toBe(
        "previous Job",
      );
    },
  );

  describe.each(["timeout", "cancel"] as const)(
    "operation %s",
    (interruption) => {
      it.each([
        ["GET /api/v1/source-tickets", undefined],
        ["POST /api/v1/source-tickets", undefined],
        ["PUT /upload", undefined],
        ["POST /api/v1/render-tickets", undefined],
        [`GET /api/v1/jobs/${wireJobId}`, null],
        [`GET /api/v1/jobs/${wireJobId}/artifacts/result.pdf`, "succeeded"],
      ] as const)("interrupts a stalled %s", async (phase, lastStatus) => {
        const root = await temporaryRoot();
        await writeFile(join(root, "main.tex"), "fixture");
        const output = join(root, "output");
        if (lastStatus === "succeeded") {
          await mkdir(output, { mode: 0o700 });
          await writeFile(join(output, "result.pdf"), "prior PDF");
        }
        const reached = deferred<AbortSignal | undefined>();
        const controller = new AbortController();
        const cancel = new AppError("CLIENT_CANCELED", "Canceled locally", 499);
        const client = renderWire((route, init) => {
          if (route !== phase) return;
          const signal = init?.signal ?? undefined;
          if (lastStatus === "succeeded")
            return new Response(
              new ReadableStream<Uint8Array>({
                start(stream) {
                  stream.enqueue(new TextEncoder().encode("result."));
                },
                pull() {
                  reached.resolve(signal);
                },
              }),
            );
          reached.resolve(signal);
          return new Promise<Response>((_resolve, reject) =>
            signal?.addEventListener(
              "abort",
              () => reject(signal.reason as Error),
              { once: true },
            ),
          );
        });
        const events: ClientCoreEvent[] = [];
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const result = withClientOperationDeadline(
          (signal) =>
            renderProject(client, root, {
              signal,
              outputDirectory: output,
              onEvent: (event) => events.push(event),
            }),
          { signal: controller.signal, timeoutMs: 100 },
        ).catch((error: unknown) => error);
        const signal = await Promise.race([reached.promise, result]);
        expect(signal).toBeInstanceOf(AbortSignal);
        if (interruption === "cancel") controller.abort(cancel);
        else await vi.advanceTimersByTimeAsync(100);

        const error = await result;
        expect(error).toMatchObject({
          code:
            interruption === "cancel"
              ? "CLIENT_CANCELED"
              : "CLIENT_OPERATION_TIMEOUT",
        });
        expect(acceptedJobRecovery(error)).toEqual(
          lastStatus === undefined
            ? undefined
            : { jobId: wireJobId, lastStatus },
        );
        expect(events.filter(({ type }) => type === "job.queued")).toEqual(
          lastStatus === undefined
            ? []
            : [{ type: "job.queued", jobId: wireJobId }],
        );
        expect(events.some(({ type }) => type === "artifact.downloaded")).toBe(
          false,
        );
        if (lastStatus === "succeeded") {
          expect(await readdir(output)).toEqual(["result.pdf"]);
          expect(await readFile(join(output, "result.pdf"), "utf8")).toBe(
            "prior PDF",
          );
        } else {
          await expect(lstat(output)).rejects.toMatchObject({ code: "ENOENT" });
        }
      });
    },
  );
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function renderWire(
  override: (
    route: string,
    init?: RequestInit,
  ) => Response | Promise<Response> | undefined,
): RendererClient {
  const origin = "https://renderer.example.test";
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  vi.stubGlobal("fetch", async (url: URL, init?: RequestInit) => {
    const route = `${init?.method ?? "GET"} ${url.pathname}`;
    const response = override(route, init);
    if (response !== undefined) return response;
    switch (route) {
      case "GET /api/v1/source-tickets":
        return Response.json({
          maxUploadBytes: 4096,
          maxExtractedBytes: 4096,
          maxFileCount: 4,
          maxZipEntries: 4,
        });
      case "POST /api/v1/source-tickets":
        return Response.json({
          sourceId: wireSourceId,
          uploadRequired: true,
          uploadUrl: `${origin}/upload`,
          uploadTicket: "source-upload-ticket",
          expiresAt,
        });
      case "PUT /upload":
        if (!(init?.body instanceof ReadableStream))
          throw new Error("Expected ZIP stream");
        await new Response(init.body).arrayBuffer();
        return new Response(null, { status: 204 });
      case "POST /api/v1/render-tickets":
        return Response.json({
          jobId: wireJobId,
          jobTicket: wireTicket,
          expiresAt,
        });
      case wireJob:
        return Response.json({
          ...job("succeeded"),
          id: wireJobId,
          artifacts: [
            artifact("pdf", "result.pdf"),
            artifact("log", "compile.log"),
            artifact("svg", wireSvg),
          ],
        });
      default: {
        const file = wireArtifactFiles.get(route);
        if (file !== undefined) return new Response(file);
        throw new Error(`Unexpected fixture request ${route}`);
      }
    }
  });
  return new RendererClient(origin, "fixture-key");
}

function job(status: JobResponse["status"]): JobResponse {
  const artifacts = [
    artifact("log", "compile.log"),
    artifact("errors", "errors.json"),
    ...(status === "succeeded" ? [artifact("pdf", "result.pdf")] : []),
  ];
  return {
    id: "job_test",
    status,
    sourceSize: 100,
    sourceSha256: "a".repeat(64),
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    errorCode: status === "failed" ? "LATEX_ERROR" : null,
    errorMessage: status === "failed" ? "Compilation failed" : null,
    retentionExpiresAt: "2026-08-12T00:00:00.000Z",
    artifacts: status === "canceled" ? [] : artifacts,
    previews:
      status === "succeeded"
        ? [artifact("preview", "previews/page-1.png")]
        : [],
  };
}

function artifact(
  type: string,
  relativePath: string,
): JobResponse["artifacts"][number] {
  return {
    type,
    relativePath,
    size: Buffer.byteLength(relativePath.replace(/^previews\//, "")),
    sha256: createHash("sha256")
      .update(relativePath.replace(/^previews\//, ""))
      .digest("hex"),
    createdAt: "2026-08-11T00:00:00.000Z",
    downloadUrl: `/api/v1/jobs/job_test/artifacts/${relativePath}`,
  };
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "client-core-test-"));
  temporaryRoots.push(root);
  return root;
}
