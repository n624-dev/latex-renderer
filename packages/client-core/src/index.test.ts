import { createHash } from "node:crypto";
import {
  readFile,
  readdir,
  rm,
  writeFile,
  mkdir,
  mkdtemp,
  lstat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type {
  JobResponse,
  RenderEngine,
  SourceRenderResponse,
  SourceTicketResponse,
} from "@latex-renderer/contracts";
import { AppError } from "@latex-renderer/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RendererClient } from "../../api-client/src/index.js";
import {
  compileProjectPdf,
  acceptedJobRecovery,
  downloadJobArtifacts,
  getJob,
  renderProject,
  renderSource,
  requestJobAction,
  shouldExcludeProjectPath,
  uploadProjectSource,
  withClientOperationDeadline,
  type ClientCoreEvent,
  type ClientTransport,
} from "./index.js";

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
  it("returns the accepted ID and terminal status after an artifact transfer fails", async () => {
    const root = await temporaryRoot();
    const jobId = `job_${"4".repeat(32)}`;
    const complete = { ...job("succeeded"), id: jobId };
    const client = new FakeClient([complete]);
    client.createSourceJob = () =>
      Promise.resolve({
        jobId,
        jobTicket: "job-ticket-fixture",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });
    client.download = () =>
      Promise.reject(new Error("credential in upstream URL"));
    const target = join(root, "out");
    await expect(
      renderSource(client, "source_fixture", { outputDirectory: target }).catch(
        (error: unknown) => {
          expect(error instanceof Error && error.message).not.toContain(
            "credential in upstream URL",
          );
          return acceptedJobRecovery(error);
        },
      ),
    ).resolves.toEqual({ jobId, lastStatus: "succeeded" });
  });

  it.each(["lualatex", "pdflatex", "xelatex", "platex", "uplatex"] as const)(
    "sends the explicitly selected %s engine with the compile request",
    async (engine) => {
      const root = await temporaryRoot();
      await writeFile(join(root, "main.tex"), "document");
      const client = new FakeClient([job("succeeded")]);
      await compileProjectPdf(client, "main.tex", {
        projectRoot: root,
        engine,
      });
      expect(client.engines).toEqual([engine]);
    },
  );

  it("compiles a nested entrypoint and replaces only the requested PDF", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "chapters"));
    await mkdir(join(root, "build"), { mode: 0o700 });
    await writeFile(join(root, "chapters", "report.tex"), "document");
    await writeFile(join(root, "notes.bib"), "references");
    await writeFile(join(root, "build", "report.pdf"), "prior PDF");
    await writeFile(join(root, "build", "figure.pdf"), "a figure");
    const client = new FakeClient([job("succeeded")]);
    const result = await compileProjectPdf(client, "chapters/report.tex", {
      projectRoot: root,
      output: "build/report.pdf",
    });
    expect(client.entrypoints).toEqual(["chapters/report.tex"]);
    expect(client.archiveNames).toContain("notes.bib");
    expect(client.archiveNames).toContain("build/figure.pdf");
    expect(client.archiveNames).not.toContain("build/report.pdf");
    expect(result.pdf).toBe(join(root, "build", "report.pdf"));
    expect(await readFile(join(root, "build", "report.pdf"), "utf8")).toBe(
      "result.pdf",
    );
    expect(await readFile(join(root, "build", "figure.pdf"), "utf8")).toBe(
      "a figure",
    );
  });

  it("retains the previous PDF on rendering or transfer failure", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "main.tex"), "document");
    const destination = join(root, "main.pdf");
    await writeFile(destination, "prior PDF");
    const failed = new FakeClient([job("failed")]);
    expect(
      (await compileProjectPdf(failed, "main.tex", { projectRoot: root })).job
        .status,
    ).toBe("failed");
    const corrupted = new FakeClient([job("succeeded")]);
    corrupted.download = async (_url, _ticket, path) =>
      writeFile(path, "corrupt");
    await expect(
      compileProjectPdf(corrupted, "main.tex", { projectRoot: root }),
    ).rejects.toThrow("advertised size and SHA256");
    expect(await readFile(destination, "utf8")).toBe("prior PDF");
  });
  it("renews an expired ticket between artifacts without restarting the publication", async () => {
    const root = await temporaryRoot();
    const complete = job("succeeded");
    const client = new FakeClient([complete]);
    let sequence = 0;
    const original = client.download.bind(client);
    const tokens: string[] = [];
    client.renewJobTicket = () =>
      Promise.resolve({
        jobTicket: `ticket-${++sequence}`,
        expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
      });
    client.download = async (url, ticket, destination) => {
      tokens.push(ticket);
      if (url.endsWith("errors.json") && ticket === "ticket-1")
        throw new AppError("INVALID_TICKET", "Ticket expired", 401);
      await original(url, ticket, destination);
    };
    const output = join(root, "out");
    const result = await downloadJobArtifacts(client, complete.id, output);
    expect(tokens.slice(0, 4)).toEqual([
      "ticket-1",
      "ticket-1",
      "ticket-2",
      "ticket-2",
    ]);
    expect(sequence).toBe(2);
    expect(result.artifacts.pdf).toBe(join(output, "result.pdf"));
    expect(await readFile(result.artifacts.log ?? "", "utf8")).toBe(
      "compile.log",
    );
  });

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

  it("generates only explicitly requested pages and downloads against fresh real metadata", async () => {
    const root = await temporaryRoot(),
      initial = { ...job("succeeded"), previewPageCount: 3 },
      complete = {
        ...initial,
        previews: [
          ...initial.previews,
          artifact("preview", "previews/page-3.png"),
        ],
      };
    const client: ClientTransport = new FakeClient([initial, complete]);
    const requested: number[] = [];
    client.preparePreview = (_id, page) => {
      requested.push(page);
      return Promise.resolve();
    };
    const result = await downloadJobArtifacts(
      client,
      initial.id,
      join(root, "out"),
      { previewPages: [3, 3] },
    );
    expect(requested).toEqual([3]);
    expect(result.job.previews).toEqual(complete.previews);
    expect(
      result.artifacts.previews.map((p) => p.split(/[\\/]/).at(-1)),
    ).toEqual(["page-1.png", "page-3.png"]);
  });
  it("leaves prior artifacts untouched when a requested preview is still pending", async () => {
    const root = await temporaryRoot(),
      output = join(root, "out"),
      initial = { ...job("succeeded"), previewPageCount: 3 };
    const client: ClientTransport = new FakeClient([initial, initial]);
    await downloadJobArtifacts(client, initial.id, output);
    const before = await readFile(join(output, "job.json"), "utf8");
    client.preparePreview = () => Promise.reject(new Error("preview pending"));
    await expect(
      downloadJobArtifacts(client, initial.id, output, { previewPages: [2] }),
    ).rejects.toThrow("preview pending");
    expect(await readFile(join(output, "job.json"), "utf8")).toBe(before);
  });
  it("does not publish a mixed set or successful events when a later artifact is corrupt", async () => {
    const root = await temporaryRoot(),
      output = join(root, ".render"),
      value = job("succeeded");
    const transport = new FakeClient([value, value]);
    await downloadJobArtifacts(transport, value.id, output);
    const before = await readFile(join(output, "job.json"), "utf8");
    value.updatedAt = "2026-09-19T00:00:00.000Z";
    const normalDownload = transport.download.bind(transport);
    transport.download = async (url, ticket, destination) => {
      if (url === "artifact:errors.json")
        await writeFile(destination, "broken.json");
      else await normalDownload(url, ticket, destination);
    };
    const events: ClientCoreEvent[] = [];
    await expect(
      downloadJobArtifacts(transport, value.id, output, {
        onEvent: (event) => events.push(event),
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_INTEGRITY_ERROR" });
    expect(await readFile(join(output, "job.json"), "utf8")).toBe(before);
    expect(await readFile(join(output, "errors.json"), "utf8")).toBe(
      "errors.json",
    );
    expect(
      events.filter((event) => event.type === "artifact.downloaded"),
    ).toEqual([]);
  });
  it.each([
    "main.log",
    "main.aux",
    "build/main.fls",
    "main.fdb_latexmk",
    "main.synctex.gz",
    ".render/result.pdf",
    ".render.latex-renderer-state/transaction/stage/result.pdf",
    "custom.latex-renderer-state/transaction/backup/result.pdf",
    ".git/config",
    ".env",
    ".env.local",
    "credentials.json",
    "private.pem",
    "node_modules/package/index.js",
  ])("excludes generated project path %s", (path) => {
    expect(shouldExcludeProjectPath(path)).toBe(true);
  });

  it.each([
    "main.tex",
    "chapters/intro.tex",
    "figures/plot.pdf",
    "data/results.csv",
  ])("keeps source project path %s", (path) => {
    expect(shouldExcludeProjectPath(path)).toBe(false);
  });

  it("uses one render pipeline for archive, upload, polling, and artifacts", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "main.tex"), "\\documentclass{article}");
    await writeFile(join(root, "main.log"), "generated");
    await mkdir(join(root, "chapters"));
    await writeFile(join(root, "chapters", "intro.tex"), "intro");
    const client = new FakeClient([
      job("queued"),
      job("running"),
      job("succeeded"),
    ]);
    const events: ClientCoreEvent[] = [];

    const result = await renderProject(client, root, {
      pollIntervalMs: 0,
      sleep: () => Promise.resolve(),
      onEvent: (event) => events.push(event),
    });

    expect(result.job.status).toBe("succeeded");
    expect(result.source.files).toBe(2);
    expect(result.source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(client.uploadedSize).toBe(result.source.size);
    expect(client.archiveNames).toEqual(["chapters/intro.tex", "main.tex"]);
    expect(events.filter(({ type }) => type === "job.status")).toMatchObject([
      { status: "queued" },
      { status: "running" },
      { status: "succeeded" },
    ]);
    await expect(readFile(result.artifacts.pdf ?? "", "utf8")).resolves.toBe(
      "result.pdf",
    );
    await expect(readFile(result.artifacts.errors ?? "", "utf8")).resolves.toBe(
      "errors.json",
    );
    expect(result.artifacts.previews).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("ticket-value");
    expect(
      events.some(
        (event) =>
          event.type === "artifact.downloaded" &&
          event.name === "previews/page-1.png",
      ),
    ).toBe(true);
    expect(
      await lstat(client.uploadedPath).catch(() => undefined),
    ).toBeUndefined();
  });

  it.each([
    ["default", undefined],
    ["custom", "out"],
    ["nested", "build/out"],
    ["outside", "../results"],
  ] as const)(
    "does not archive the %s output directory on rerender",
    async (_name, target) => {
      const workspace = await temporaryRoot(),
        project = join(workspace, "project");
      await mkdir(join(project, "out-copy"), { recursive: true, mode: 0o700 });
      await writeFile(join(project, "main.tex"), "main");
      await writeFile(join(project, "out-copy", "keep.txt"), "user file");
      const client = new FakeClient([job("succeeded"), job("succeeded")]);
      const options =
        target === undefined
          ? {}
          : { outputDirectory: resolve(project, target) };

      await renderProject(client, project, options);
      await renderProject(client, project, options);

      expect(client.archiveNames).toEqual([
        "main.tex",
        "out-copy/keep.txt",
        "main.tex",
        "out-copy/keep.txt",
      ]);
      expect(
        await readFile(join(project, "out-copy", "keep.txt"), "utf8"),
      ).toBe("user file");
    },
  );

  it("rejects the project root itself as an output directory before Source reservation", async () => {
    const project = await temporaryRoot();
    await writeFile(join(project, "main.tex"), "main");
    const client = new FakeClient([]);

    await expect(
      renderProject(client, project, { outputDirectory: project }),
    ).rejects.toMatchObject({
      code: "INVALID_OUTPUT_DIRECTORY",
    });
    expect(client.createdTickets).toBe(0);
  });

  it("waits for a terminal Job without changing the previous artifact generation", async () => {
    const root = await temporaryRoot(),
      output = join(root, ".render");
    const first = job("succeeded"),
      last = job("succeeded");
    last.updatedAt = "2026-09-27T00:00:00.000Z";
    const client = new FakeClient([first, job("queued"), job("running"), last]);
    await downloadJobArtifacts(client, first.id, output);
    const previous = await readFile(join(output, "job.json"), "utf8");
    let waits = 0;

    const result = await downloadJobArtifacts(client, first.id, output, {
      pollIntervalMs: 0,
      sleep: async () => {
        waits += 1;
        expect(await readFile(join(output, "job.json"), "utf8")).toBe(previous);
        expect(await readFile(join(output, "result.pdf"), "utf8")).toBe(
          "result.pdf",
        );
      },
    });

    expect(waits).toBe(2);
    expect(result.job.updatedAt).toBe(last.updatedAt);
    expect(await readFile(join(output, "job.json"), "utf8")).not.toBe(previous);
  });

  it("reports a host-resource wait without turning it into a terminal render failure", async () => {
    const root = await temporaryRoot();
    const queued = {
      ...job("queued"),
      errorCode: "HOST_RESOURCE_WAIT",
      errorMessage: "Waiting for host resources",
    };
    const client = new FakeClient([queued, job("succeeded")]);
    const events: ClientCoreEvent[] = [];
    const result = await downloadJobArtifacts(client, queued.id, root, {
      pollIntervalMs: 0,
      sleep: () => Promise.resolve(),
      onEvent: (event) => events.push(event),
    });
    expect(result.job.status).toBe("succeeded");
    expect(events).toContainEqual({
      type: "job.status",
      jobId: queued.id,
      status: "queued",
      resourceWait: queued.errorMessage,
    });
  });

  it("leaves the previous generation intact when waiting for a Job times out", async () => {
    const root = await temporaryRoot(),
      output = join(root, ".render");
    const client = new FakeClient([job("succeeded"), job("running")]);
    await downloadJobArtifacts(client, "job_test", output);
    const previous = await readFile(join(output, "job.json"), "utf8");

    const download = downloadJobArtifacts(client, "job_test", output, {
      pollIntervalMs: 1_000,
      pollTimeoutMs: 20,
    });
    await expect(download).rejects.toMatchObject({
      code: "RENDER_POLL_TIMEOUT",
      details: { jobId: "job_test", lastStatus: "running" },
    });
    await expect(download).rejects.toThrow("did not cancel the server Job");
    expect(await readFile(join(output, "job.json"), "utf8")).toBe(previous);
    expect(await readFile(join(output, "result.pdf"), "utf8")).toBe(
      "result.pdf",
    );
  });

  it("bounds polling for long-running MCP and automation callers", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "main.tex"), "\\documentclass{article}");
    const client = new FakeClient([job("running")]);
    const times = [0, 1_001];

    await expect(
      renderProject(client, root, {
        pollIntervalMs: 1,
        pollTimeoutMs: 1_000,
        now: () => times.shift() ?? 1_001,
        sleep: () => Promise.resolve(),
      }),
    ).rejects.toMatchObject({ code: "RENDER_POLL_TIMEOUT", status: 504 });
  });

  it("applies one deadline after acceptance and keeps the original Job ID", async () => {
    const client = new FakeClient([job("running")]);
    const result = withClientOperationDeadline(
      (signal) =>
        renderSource(client, "source_test", {
          signal,
          pollIntervalMs: 1000,
        }),
      { timeoutMs: 100 },
    );
    await expect(result).rejects.toMatchObject({
      code: "CLIENT_OPERATION_TIMEOUT",
      details: { jobId: "job_test", lastStatus: "running" },
    });
    expect(client.actions).toEqual([]);
  });

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

  it("settles at the deadline even when preparation ignores the signal", async () => {
    const root = await temporaryRoot();
    const started = deferred<undefined>();
    const release = deferred<undefined>();
    const client = Object.assign(new FakeClient([]), {
      sourceLimits: () => {
        started.resolve(undefined);
        return release.promise;
      },
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let finished = false;
    const result = withClientOperationDeadline(
      (signal) => renderProject(client, root, { signal }),
      { timeoutMs: 100 },
    ).catch((error: unknown) => {
      finished = true;
      return error;
    });
    await started.promise;
    try {
      await vi.advanceTimersByTimeAsync(100);
      expect(finished).toBe(true);
      expect(await result).toMatchObject({ code: "CLIENT_OPERATION_TIMEOUT" });
    } finally {
      release.resolve(undefined);
      await result;
    }
  });

  it("preflights the server's current file count before reserving an upload", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "main.tex"), "main");
    await writeFile(join(root, "other.tex"), "other");
    const client = new FakeClient([]);
    const limited = Object.assign(client, {
      sourceLimits: () =>
        Promise.resolve({
          maxUploadBytes: 2000,
          maxExtractedBytes: 1000,
          maxFileCount: 2,
          maxZipEntries: 1,
        }),
    });
    await expect(uploadProjectSource(limited, root)).rejects.toMatchObject({
      code: "TOO_MANY_FILES",
    });
  });

  it("shares ticket renewal across get, action, and artifact operations", async () => {
    const root = await temporaryRoot();
    const client = new FakeClient([job("failed"), job("failed")]);

    await expect(getJob(client, "job_test")).resolves.toMatchObject({
      status: "failed",
    });
    await expect(
      requestJobAction(client, "job_test", "cancel"),
    ).resolves.toEqual({
      jobId: "job_test",
      action: "cancel",
      requested: true,
    });
    await expect(
      downloadJobArtifacts(client, "job_test", join(root, "artifacts")),
    ).resolves.toMatchObject({ job: { status: "failed" } });
    expect(client.renewed).toBe(3);
    expect(client.actions).toEqual(["cancel"]);
  });

  it("supports an arbitrary entrypoint and rejects a missing one locally", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "notes.tex"), "notes");
    const client = new FakeClient([job("succeeded")]);

    await expect(
      renderProject(client, root, {
        entrypoint: "notes.tex",
        pollIntervalMs: 0,
        sleep: () => Promise.resolve(),
      }),
    ).resolves.toMatchObject({
      job: { status: "succeeded" },
      source: { sourceId: "source_0123456789abcdef0123456789abcdef" },
    });
    expect(client.entrypoints).toEqual(["notes.tex"]);

    await expect(
      renderProject(client, root, { entrypoint: "missing.tex" }),
    ).rejects.toMatchObject({
      code: "ENTRYPOINT_MISSING",
    });
  });

  it("does not upload a deduplicated ready Source again", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "notes.tex"), "notes");
    const client = new FakeClient([], false);

    const source = await uploadProjectSource(client, root);

    expect(source).toMatchObject({
      sourceId: "source_0123456789abcdef0123456789abcdef",
      uploadRequired: false,
      files: 1,
    });
    expect(client.uploadedSize).toBe(0);
  });

  it("applies secure defaults and .latexrenderignore before descending", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "main.tex"), "main");
    await writeFile(join(root, ".env"), "SECRET=value");
    await writeFile(join(root, "private.pem"), "secret");
    await writeFile(
      join(root, ".latexrenderignore"),
      "drafts/\n*.csv\nREADME.md\n!.env\n",
    );
    await mkdir(join(root, "drafts"));
    await writeFile(join(root, "drafts", "notes.tex"), "draft");
    await writeFile(join(root, "results.csv"), "data");
    await writeFile(join(root, "README.md"), "ignored notes");
    await mkdir(join(root, "node_modules"));
    await symlink("/", join(root, "node_modules", "outside"));
    const client = new FakeClient([]);

    await uploadProjectSource(client, root);

    expect(client.archiveNames).toEqual(["main.tex"]);
  });

  it("rejects an unsupported directory file by path before reserving a Source", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "main.tex"), "main");
    await mkdir(join(root, "notes"));
    await writeFile(join(root, "notes", "README.md"), "notes");
    const client = new FakeClient([]);

    await expect(uploadProjectSource(client, root)).rejects.toMatchObject({
      code: "ZIP_EXTENSION_REJECTED",
      message: "Unsupported project file: notes/README.md",
    });
    expect(client.createdTickets).toBe(0);
  });

  it("stops project collection as soon as the file limit is exceeded", async () => {
    const root = await temporaryRoot();
    await Promise.all(
      Array.from({ length: 501 }, (_, index) =>
        writeFile(
          join(root, `source-${String(index).padStart(3, "0")}.tex`),
          "x",
        ),
      ),
    );
    await expect(
      uploadProjectSource(new FakeClient([], false), root),
    ).rejects.toMatchObject({
      code: "TOO_MANY_FILES",
    });
  });

  it("returns terminal jobs that do not advertise any artifacts", async () => {
    const root = await temporaryRoot();
    const result = await downloadJobArtifacts(
      new FakeClient([job("canceled")]),
      "job_test",
      join(root, "artifacts"),
    );

    expect(result.job.status).toBe("canceled");
    expect(result.artifacts).toMatchObject({ previews: [], svg: [] });
    expect(result.artifacts.pdf).toBeUndefined();
    expect(result.artifacts.errors).toBeUndefined();
    expect(result.artifacts.log).toBeUndefined();
    await expect(readFile(result.artifacts.job, "utf8")).resolves.toContain(
      '"status": "canceled"',
    );
  });

  it("rejects a symlinked job.json without changing its target", async () => {
    const root = await temporaryRoot(),
      output = join(root, "artifacts"),
      victim = join(root, "victim");
    await mkdir(output, { mode: 0o700 });
    await writeFile(victim, "keep");
    await symlink(victim, join(output, "job.json"));

    await expect(
      downloadJobArtifacts(
        new FakeClient([job("canceled")]),
        "job_test",
        output,
      ),
    ).rejects.toMatchObject({ code: "UNSAFE_OUTPUT_PATH" });
    await expect(readFile(victim, "utf8")).resolves.toBe("keep");
  });
});

class FakeClient implements ClientTransport {
  readonly actions: string[] = [];
  readonly archiveNames: string[] = [];
  readonly entrypoints: string[] = [];
  readonly engines: (RenderEngine | undefined)[] = [];
  createdTickets = 0;
  renewed = 0;
  uploadedPath = "";
  uploadedSize = 0;
  readonly #jobs: JobResponse[];

  constructor(
    jobs: JobResponse[],
    private readonly sourceUploadRequired = true,
  ) {
    this.#jobs = [...jobs];
  }

  createSource(): Promise<SourceTicketResponse> {
    this.createdTickets += 1;
    return Promise.resolve({
      sourceId: "source_0123456789abcdef0123456789abcdef",
      uploadRequired: this.sourceUploadRequired,
      ...(this.sourceUploadRequired
        ? {
            uploadTicket: "upload-ticket-value",
            uploadUrl: "https://example.test/upload",
          }
        : {}),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
  }

  async uploadSource(
    _ticket: SourceTicketResponse,
    zipPath: string,
    size: number,
  ): Promise<void> {
    this.uploadedPath = zipPath;
    this.uploadedSize = size;
    this.archiveNames.push(...zipEntryNames(await readFile(zipPath)));
  }

  createSourceJob(
    _sourceId: string,
    entrypoint: string | undefined,
    _idempotencyKey?: string,
    _outputs?: unknown,
    engine?: RenderEngine,
  ): Promise<SourceRenderResponse> {
    this.entrypoints.push(entrypoint ?? "main.tex");
    this.engines.push(engine);
    return Promise.resolve({
      jobId: "job_test",
      jobTicket: "job-ticket-value",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
  }

  job(): Promise<JobResponse> {
    const value = this.#jobs.shift();
    if (value === undefined) throw new Error("Fake job sequence exhausted");
    return Promise.resolve(value);
  }

  renewJobTicket(): Promise<{ jobTicket: string; expiresAt: string }> {
    this.renewed += 1;
    return Promise.resolve({
      jobTicket: "renewed-job-ticket",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
  }

  action(
    _jobId: string,
    _jobTicket: string,
    action: "cancel" | "delete",
  ): Promise<void> {
    this.actions.push(action);
    return Promise.resolve();
  }

  artifactUrl(_jobId: string, name: string): string {
    return `artifact:${name}`;
  }

  previewUrl(_jobId: string, page: string): string {
    return `preview:${page}`;
  }

  async download(
    url: string,
    _ticket: string,
    destination: string,
  ): Promise<void> {
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, url.replace(/^(?:artifact|preview):/, ""));
  }
}

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

function zipEntryNames(archive: Buffer): string[] {
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  const names: string[] = [];
  let offset = archive.indexOf(signature);
  while (offset >= 0) {
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    names.push(
      archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"),
    );
    offset = archive.indexOf(
      signature,
      offset + 46 + nameLength + extraLength + commentLength,
    );
  }
  return names;
}
