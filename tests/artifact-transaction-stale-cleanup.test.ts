import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { JobArtifact, JobResponse } from "@latex-renderer/contracts";
import { pruneGeneratedArtifacts } from "../packages/client-core/src/artifact-cleanup.js";
import { publishArtifactSet } from "../packages/client-core/src/artifact-transaction.js";
import {
  renderProject,
  type ClientTransport,
} from "../packages/client-core/src/index.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("stale artifacts on the host filesystem", () => {
  it("rerenders through the client pipeline from three pages to one", async () => {
    const root = await mkdtemp(join(tmpdir(), "artifact-rerender-"));
    roots.push(root);
    await writeFile(join(root, "main.tex"), "first revision");
    const output = join(root, ".render");
    const content = new Map<string, string>();
    const artifact = (
      jobId: string,
      relativePath: string,
      type: string,
      bytes: string,
    ): JobArtifact => {
      content.set(`${jobId}/${relativePath}`, bytes);
      return {
        relativePath,
        type,
        size: Buffer.byteLength(bytes),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        createdAt: "2026-09-26T00:00:00.000Z",
        downloadUrl: `/api/v1/jobs/${jobId}/artifacts/${relativePath}`,
      };
    };
    const job = (id: string, pages: number): JobResponse => ({
      id,
      status: "succeeded",
      sourceSize: 1,
      sourceSha256: "0".repeat(64),
      createdAt: "2026-09-26T00:00:00.000Z",
      updatedAt: "2026-09-26T00:00:00.000Z",
      errorCode: null,
      errorMessage: null,
      retentionExpiresAt: null,
      artifacts: [artifact(id, "result.pdf", "pdf", `${id}-pdf`)],
      previews: Array.from({ length: pages }, (_, index) => {
        const page = index + 1;
        return artifact(
          id,
          `previews/page-${page}.png`,
          "preview",
          `${id}-page-${page}`,
        );
      }),
    });
    const jobs = [job("job_first", 3), job("job_second", 1)];
    let nextJob = 0;
    const transport: ClientTransport = {
      createSource: () =>
        Promise.resolve({
          sourceId: `source_${"0".repeat(32)}`,
          uploadRequired: false,
          expiresAt: "2026-09-27T00:00:00.000Z",
        }),
      uploadSource: () =>
        Promise.reject(new Error("ready Source must not be uploaded")),
      createSourceJob: () =>
        Promise.resolve({
          jobId: jobs[nextJob++]?.id ?? "unexpected-job",
          jobTicket: "test-ticket",
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        }),
      job: (id) => {
        const result = jobs.find((item) => item.id === id);
        if (result === undefined)
          return Promise.reject(new Error(`Unknown Job ${id}`));
        return Promise.resolve(result);
      },
      renewJobTicket: () =>
        Promise.resolve({
          jobTicket: "renewed-test-ticket",
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        }),
      action: () => Promise.resolve(),
      artifactUrl: (id, name) => `${id}/${name}`,
      previewUrl: (id, name) => `${id}/previews/${name}`,
      download: async (url, _ticket, destination) => {
        const bytes = content.get(url);
        if (bytes === undefined) throw new Error(`Unknown artifact ${url}`);
        await writeFile(destination, bytes);
      },
    };

    const first = await renderProject(transport, root);
    expect(first.job.id).toBe("job_first");
    expect(await readdir(join(output, "previews"))).toEqual([
      "page-1.png",
      "page-2.png",
      "page-3.png",
    ]);
    await writeFile(join(output, "notes.txt"), "user-notes");
    await writeFile(join(root, "main.tex"), "second revision");
    const second = await renderProject(transport, root);

    expect(second.job.id).toBe("job_second");
    expect(await readFile(join(output, "result.pdf"), "utf8")).toBe(
      "job_second-pdf",
    );
    expect(await readFile(join(output, "previews", "page-1.png"), "utf8")).toBe(
      "job_second-page-1",
    );
    expect(await readdir(join(output, "previews"))).toEqual(["page-1.png"]);
    expect(await readFile(join(output, "notes.txt"), "utf8")).toBe(
      "user-notes",
    );
    const recordedJob: unknown = JSON.parse(
      await readFile(join(output, "job.json"), "utf8"),
    );
    expect(recordedJob).toMatchObject({ id: "job_second" });
    expect(await readdir(`${output}.latex-renderer-state`)).toEqual([]);
  });

  it("replaces a three-page result with one page without deleting user files", async () => {
    const root = await mkdtemp(join(tmpdir(), "artifact-stale-cleanup-"));
    roots.push(root);
    const output = join(root, ".render");
    await mkdir(join(output, "previews"), { recursive: true });
    await writeFile(join(output, "result.pdf"), "old-pdf");
    await writeFile(join(output, "notes.txt"), "user-notes");
    for (let page = 1; page <= 3; page += 1)
      await writeFile(
        join(output, "previews", `page-${page}.png`),
        `old-${page}`,
      );
    await writeFile(
      join(output, "job.json"),
      JSON.stringify({
        artifacts: [{ relativePath: "result.pdf" }],
        previews: [1, 2, 3].map((page) => ({
          relativePath: `previews/page-${page}.png`,
        })),
      }),
    );

    await publishArtifactSet(output, async (stage) => {
      await pruneGeneratedArtifacts(
        stage,
        new Set(["result.pdf", "previews/page-1.png"]),
      );
      await writeFile(join(stage, "result.pdf"), "new-pdf");
      await writeFile(join(stage, "previews", "page-1.png"), "new-1");
      await writeFile(
        join(stage, "job.json"),
        JSON.stringify({
          artifacts: [{ relativePath: "result.pdf" }],
          previews: [{ relativePath: "previews/page-1.png" }],
        }),
      );
    });

    expect(await readFile(join(output, "result.pdf"), "utf8")).toBe("new-pdf");
    expect(await readFile(join(output, "previews", "page-1.png"), "utf8")).toBe(
      "new-1",
    );
    expect(await readdir(join(output, "previews"))).toEqual(["page-1.png"]);
    expect(await readFile(join(output, "notes.txt"), "utf8")).toBe(
      "user-notes",
    );
    expect(await readdir(`${output}.latex-renderer-state`)).toEqual([]);
  });
});
