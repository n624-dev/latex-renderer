import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import type { JobArtifact, JobResponse } from "@latex-renderer/contracts";
import { createProjectArchive, downloadJobArtifacts, renderSource, type ClientTransport } from "../packages/client-core/src/index.js";

const timestamp = "2026-01-01T00:00:00.000Z";
function artifact(relativePath: string, type: string): JobArtifact {
  return { relativePath, type, size: 1, sha256: "0".repeat(64), createdAt: timestamp, downloadUrl: `/api/v1/jobs/job_test/artifacts/${relativePath}` };
}
function job(status: JobResponse["status"] = "succeeded"): JobResponse {
  return { id: "job_test", status, sourceSize: 1, sourceSha256: "0".repeat(64), createdAt: timestamp, updatedAt: timestamp, errorCode: null, errorMessage: null, retentionExpiresAt: null, artifacts: [], previews: [] };
}
function client(current: () => JobResponse, downloadedTickets: string[] = []): ClientTransport {
  return {
    createSource: () => Promise.resolve({ sourceId: `source_${"0".repeat(32)}`, uploadRequired: false, expiresAt: timestamp }),
    uploadSource: () => Promise.resolve(),
    createSourceJob: () => Promise.resolve({ jobId: "job_test", jobTicket: "expired", expiresAt: timestamp }),
    job: () => Promise.resolve(current()),
    renewJobTicket: () => Promise.resolve({ jobTicket: "renewed", expiresAt: new Date(Date.now() + 1_800_000).toISOString() }),
    action: () => Promise.resolve(),
    artifactUrl: (_id, name) => name,
    previewUrl: (_id, name) => `previews/${name}`,
    download: async (url, token, destination) => {
      downloadedTickets.push(token);
      await writeFile(destination, url);
    },
  };
}
async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "client-audit-integration-"));
  try { await run(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

describe("client audit integration", () => {
  it("keeps a pre-existing archive when exclusive creation fails", async () => fixture(async root => {
    const destination = join(root, "source.zip");
    await writeFile(join(root, "main.tex"), "source");
    await writeFile(destination, "keep existing archive");
    await assert.rejects(createProjectArchive(root, destination, "main.tex"), { code: "EEXIST" });
    assert.equal(await readFile(destination, "utf8"), "keep existing archive");
  }));

  it("does not create the destination before entrypoint validation", async () => fixture(async root => {
    const destination = join(root, "source.zip");
    await assert.rejects(createProjectArchive(root, destination, "../main.tex"));
    await assert.rejects(readFile(destination), { code: "ENOENT" });
  }));

  it("fetches an old padded preview by its real server name but stores a canonical name", async () => fixture(async root => {
    const value = job();
    value.previews = [artifact("previews/page-01.png", "preview"), artifact("previews/page-010.png", "preview")];
    const result = await downloadJobArtifacts(client(() => value), value.id, root);
    assert.deepEqual(result.artifacts.previews, [join(root, "previews/page-1.png"), join(root, "previews/page-10.png")]);
    assert.equal(await readFile(join(root, "previews/page-1.png"), "utf8"), "previews/page-01.png");
  }));

  it("rejects two preview names representing the same page", async () => fixture(async root => {
    const value = job();
    value.previews = [artifact("previews/page-01.png", "preview"), artifact("previews/page-1.png", "preview")];
    await assert.rejects(downloadJobArtifacts(client(() => value), value.id, root), { code: "INVALID_ARTIFACT_PATH" });
  }));

  it("cleans recorded old outputs after a terminal job with no artifacts", async () => fixture(async root => {
    let current = job();
    current.artifacts = [artifact("result.pdf", "pdf"), artifact("svg/manifest.json", "svg_manifest"), artifact("svg/objects/math-000001.svg", "svg")];
    current.previews = [artifact("previews/page-01.png", "preview")];
    const transport = client(() => current);
    await downloadJobArtifacts(transport, current.id, root);
    await writeFile(join(root, "notes.txt"), "keep");
    current = job("canceled");
    await downloadJobArtifacts(transport, current.id, root);
    for (const name of ["result.pdf", "previews/page-1.png", "svg/manifest.json", "svg/objects/math-000001.svg"]) {
      await assert.rejects(readFile(join(root, name)), { code: "ENOENT" });
    }
    assert.equal(await readFile(join(root, "notes.txt"), "utf8"), "keep");
    assert.match(await readFile(join(root, "job.json"), "utf8"), /"status": "canceled"/);
  }));

  it("passes the renewed polling ticket through to artifact download", async () => fixture(async root => {
    const value = job(), tokens: string[] = [];
    value.artifacts = [artifact("result.pdf", "pdf")];
    const result = await renderSource(client(() => value, tokens), `source_${"0".repeat(32)}`, { outputDirectory: root });
    assert.equal(result.job.status, "succeeded");
    assert.deepEqual(tokens, ["renewed"]);
  }));
});
