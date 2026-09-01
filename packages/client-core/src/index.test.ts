import {
  readFile,
  rm,
  writeFile,
  mkdir,
  mkdtemp,
  lstat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  JobResponse,
  SourceRenderResponse,
  SourceTicketResponse,
} from "@latex-renderer/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  downloadJobArtifacts,
  getJob,
  renderProject,
  requestJobAction,
  shouldExcludeProjectPath,
  uploadProjectSource,
  type ClientCoreEvent,
  type ClientTransport,
} from "./index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("client core", () => {
  it.each([
    "main.log",
    "main.aux",
    "build/main.fls",
    "main.fdb_latexmk",
    "main.synctex.gz",
    ".render/result.pdf",
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
      "drafts/\n*.csv\n!.env\n",
    );
    await mkdir(join(root, "drafts"));
    await writeFile(join(root, "drafts", "notes.tex"), "draft");
    await writeFile(join(root, "results.csv"), "data");
    await mkdir(join(root, "node_modules"));
    await symlink("/", join(root, "node_modules", "outside"));
    const client = new FakeClient([]);

    await uploadProjectSource(client, root);

    expect(client.archiveNames).toEqual(["main.tex"]);
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

  createSource(
    _size: number,
    _sha256: string,
    _idempotencyKey: string,
  ): Promise<SourceTicketResponse> {
    void _size;
    void _sha256;
    void _idempotencyKey;
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
      expiresAt: "2026-08-11T00:00:00.000Z",
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
    _idempotencyKey: string,
  ): Promise<SourceRenderResponse> {
    void _sourceId;
    void _idempotencyKey;
    this.entrypoints.push(entrypoint ?? "main.tex");
    return Promise.resolve({
      jobId: "job_test",
      jobTicket: "job-ticket-value",
      expiresAt: "2026-08-11T00:00:00.000Z",
    });
  }

  job(_jobId: string, _jobTicket: string): Promise<JobResponse> {
    void _jobId;
    void _jobTicket;
    const value = this.#jobs.shift();
    if (value === undefined) throw new Error("Fake job sequence exhausted");
    return Promise.resolve(value);
  }

  renewJobTicket(
    _jobId: string,
  ): Promise<{ jobTicket: string; expiresAt: string }> {
    void _jobId;
    this.renewed += 1;
    return Promise.resolve({
      jobTicket: "renewed-job-ticket",
      expiresAt: "2026-08-11T00:00:00.000Z",
    });
  }

  action(
    _jobId: string,
    _jobTicket: string,
    action: "cancel" | "delete",
  ): Promise<void> {
    void _jobId;
    void _jobTicket;
    this.actions.push(action);
    return Promise.resolve();
  }

  artifactUrl(_jobId: string, name: string): string {
    void _jobId;
    return `artifact:${name}`;
  }

  previewUrl(_jobId: string, page: string): string {
    void _jobId;
    return `preview:${page}`;
  }

  async download(
    url: string,
    _ticket: string,
    destination: string,
  ): Promise<void> {
    void _ticket;
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, url.replace(/^(?:artifact|preview):/, ""));
  }
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
    size: 1,
    sha256: "b".repeat(64),
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
