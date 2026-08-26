import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import yazl from "yazl";
import {
  cancelRenderJob,
  createAdminRenderTicket,
  createAdminSourceRef,
  fetchAdminRenderTargets,
  fetchRenderJob,
  inspectZip,
  inspectZipCandidates,
  parseJobArtifact,
  parseRenderTicket,
  renderScript,
  runBoundedBatch,
  sha256Hex,
  uploadRenderZip,
  zipSingleTex,
  zipStoredFiles,
  type RenderFetch,
} from "../apps/admin-web/src/assets/render-script.js";
import { adminRenderPage } from "../apps/admin-web/src/templates-admin.js";

describe("Web render ZIP preflight", () => {
  it("accepts only canonical nested SVG artifact paths", () => {
    const jobId = `job_${"a".repeat(32)}`,
      value = {
        type: "svg",
        relativePath: "svg/objects/math-000001.svg",
        size: 12,
        sha256: "b".repeat(64),
        createdAt: "2026-08-18T00:00:00.000Z",
        downloadUrl: `/api/v1/jobs/${jobId}/artifacts/svg/objects/math-000001.svg`,
      };
    expect(parseJobArtifact(value, jobId, false)).toMatchObject(value);
    expect(() =>
      parseJobArtifact(
        {
          ...value,
          relativePath: "svg/objects/../result.pdf",
          downloadUrl: `/api/v1/jobs/${jobId}/artifacts/svg/objects/../result.pdf`,
        },
        jobId,
        false,
      ),
    ).toThrow(/成果物情報/);
  });

  it("detects a root main.tex and counts files", async () => {
    const bytes = await zip([
      ["main.tex", "\\documentclass{article}"],
      ["images/example.png", "image"],
    ]);

    expect(inspectZip(bytes)).toEqual({ entries: 2, files: 2, mainTex: true });
  });

  it("rejects an archive without a root main.tex", async () => {
    const bytes = await zip([["project/main.tex", "nested"]]);

    expect(() => inspectZip(bytes)).toThrowError(
      "ZIPのルートに main.tex がありません",
    );
  });

  it("finds selectable TeX entrypoints and creates a main.tex ZIP from one TeX file", async () => {
    const source = await zip([
      ["chapters/a.tex", "a"],
      ["chapters/b.tex", "b"],
    ]);
    expect(inspectZipCandidates(source)).toMatchObject({
      texFiles: ["chapters/a.tex", "chapters/b.tex"],
      hasMainTex: false,
    });
    expect(inspectZip(zipSingleTex(new TextEncoder().encode("hello")))).toEqual(
      { entries: 1, files: 1, mainTex: true },
    );
  });

  it("creates a safe multi-file project ZIP while preserving paths", () => {
    const archive = zipStoredFiles([
      { name: "main.tex", bytes: new TextEncoder().encode("main") },
      { name: "images/graph.png", bytes: new TextEncoder().encode("png") },
      { name: "references.bib", bytes: new TextEncoder().encode("bib") },
    ]);
    expect(inspectZipCandidates(archive)).toMatchObject({
      files: 3,
      texFiles: ["main.tex"],
      hasMainTex: true,
    });
  });

  it("computes the standard SHA-256 digest", async () => {
    await expect(sha256Hex(new TextEncoder().encode("abc"))).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("runs at most three browser batch items concurrently", async () => {
    let active = 0,
      maximum = 0;
    await runBoundedBatch(
      Array.from({ length: 12 }, (_, index) => index),
      3,
      async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
      },
    );
    expect(maximum).toBe(3);
  });

  it("ships a self-contained script without credential persistence", () => {
    expect(() => new Script(renderScript)).not.toThrow();
    expect(renderScript).toContain("latex-renderer:preflight-ready");
    expect(renderScript).not.toContain("localStorage");
    expect(renderScript).not.toContain("sessionStorage");
    expect(renderScript).not.toContain("indexedDB");
    expect(renderScript).not.toContain("console.log");
  });

  it("renders an accessible batch workflow without operator details", () => {
    const page = adminRenderPage();

    expect(page).toContain('type="file"');
    expect(page).toContain('accept=".zip,.tex,.bib,.sty,.cls,.png');
    expect(page).toContain("webkitdirectory");
    expect(page).toContain("multiple");
    expect(page).toContain('role="status"');
    expect(page).toContain('role="alert"');
    expect(page).toContain('id="render-target"');
    expect(page).not.toContain('id="render-api-key"');
    expect(page).toContain('id="cancel-all-render"');
    expect(page).toContain('id="render-items"');
    expect(page).toContain('id="render-batch-summary"');
    expect(page).toContain('id="download-successful-render"');
    expect(page).toContain('id="retry-failed-render"');
    expect(page).toContain('id="create-source-ref"');
    expect(page).not.toContain("ZIP validator");
    expect(page).not.toContain("Gateway Worker");
    expect(page).not.toContain("sandbox");
    expect(page).not.toContain("quota");
    expect(page).toContain('src="/admin/assets/render.js"');
  });

  it("creates an owner-scoped Remote MCP source reference with the admin session", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [],
      fetcher: RenderFetch = (input, init) => {
        requests.push({ url: inputUrl(input), init });
        return Promise.resolve(
          Response.json({
            sourceRef: `source_ref_${"a".repeat(32)}`,
            expiresAt: "2026-08-11T10:15:00.000Z",
          }),
        );
      };
    await expect(
      createAdminSourceRef(
        fetcher,
        ORIGIN,
        "key_1",
        `source_${"b".repeat(32)}`,
      ),
    ).resolves.toMatchObject({ sourceRef: `source_ref_${"a".repeat(32)}` });
    expect(requests[0]?.url).toBe(`${ORIGIN}/admin/api/v1/jobs/source-refs`);
    expect(requests[0]?.init?.credentials).toBe("same-origin");
    expect(headers(requests[0]?.init).get("X-CSRF-Token")).toBe("1");
  });

  it("rejects a ticket that would send the upload token off-origin", () => {
    expect(() =>
      parseRenderTicket(
        ticketValue(
          "https://attacker.example/api/v1/jobs/job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/source",
        ),
        "https://latex.example.com",
      ),
    ).toThrowError("ZIP送信先が公開Renderer APIと一致しません");
  });

  it("uses the admin session for ticket creation and uploads with a short ticket", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetcher: RenderFetch = (input, init) => {
      const url = inputUrl(input);
      requests.push({ url, init });
      if (url.endsWith("/render-targets"))
        return Promise.resolve(
          Response.json({
            items: [
              {
                apiKeyId: "key_1",
                apiKeyName: "web",
                serviceAccountId: "sa_1",
                serviceAccountName: "browser",
                userId: "user_1",
                userEmail: "owner@example.com",
              },
            ],
          }),
        );
      if (url.endsWith("/render-tickets"))
        return Promise.resolve(
          Response.json(ticketValue(UPLOAD_URL), { status: 201 }),
        );
      return Promise.resolve(new Response(null, { status: 204 }));
    };

    const targets = await fetchAdminRenderTargets(fetcher, ORIGIN);
    const target = targets[0];
    expect(target).toBeDefined();
    if (target === undefined) throw new Error("Render target is missing");
    const ticket = await createAdminRenderTicket(
      fetcher,
      ORIGIN,
      target.apiKeyId,
      3,
      "a".repeat(64),
      "web-1234567890123456",
      ["pdf", "svg"],
    );
    await uploadRenderZip(
      fetcher,
      ticket,
      new File(["zip"], "project.zip", { type: "application/zip" }),
    );

    expect(requests.map(({ url }) => url)).toEqual([
      `${ORIGIN}/admin/api/v1/jobs/render-targets`,
      `${ORIGIN}/admin/api/v1/jobs/render-tickets`,
      UPLOAD_URL,
    ]);
    const renderRequest = requests[1];
    if (
      renderRequest === undefined ||
      typeof renderRequest.init?.body !== "string"
    )
      throw new Error("Expected a JSON render request");
    expect(headers(renderRequest.init).get("Authorization")).toBeNull();
    expect(headers(renderRequest.init).get("X-CSRF-Token")).toBe("1");
    expect(renderRequest.init.credentials).toBe("same-origin");
    expect(JSON.parse(renderRequest.init.body)).toMatchObject({
      outputs: ["pdf", "svg"],
    });
    expect(headers(requests[2]?.init).get("Authorization")).toBe(
      "Bearer upload-token-1234567890",
    );
    expect(headers(requests[2]?.init).get("Content-Type")).toBe(
      "application/zip",
    );
    expect(headers(requests[2]?.init).get("Idempotency-Key")).toBeNull();
  });

  it("polls and cancels with only the short-lived job ticket", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetcher: RenderFetch = (input, init) => {
      requests.push({
        url: inputUrl(input),
        init,
      });
      if (init?.method === "POST")
        return Promise.resolve(
          Response.json({ accepted: true }, { status: 202 }),
        );
      return Promise.resolve(
        Response.json({
          id: JOB_ID,
          status: "queued",
          errorCode: null,
          errorMessage: null,
          retentionExpiresAt: null,
          artifacts: [],
          previews: [],
        }),
      );
    };

    await expect(
      fetchRenderJob(fetcher, ORIGIN, JOB_ID, "job-token-1234567890"),
    ).resolves.toMatchObject({ status: "queued" });
    await cancelRenderJob(fetcher, ORIGIN, JOB_ID, "job-token-1234567890");

    expect(
      requests[0]?.url.startsWith(`${ORIGIN}/api/v1/jobs/${JOB_ID}?fresh=`),
    ).toBe(true);
    expect(requests[0]?.init?.cache).toBe("no-store");
    expect(headers(requests[0]?.init).get("Authorization")).toBe(
      "Bearer job-token-1234567890",
    );
    expect(requests[1]?.url).toBe(`${ORIGIN}/api/v1/jobs/${JOB_ID}/cancel`);
    expect(requests[1]?.init?.method).toBe("POST");
    expect(headers(requests[1]?.init).get("Authorization")).toBe(
      "Bearer job-token-1234567890",
    );
  });
});

const ORIGIN = "https://latex.example.com";
const JOB_ID = "job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const UPLOAD_URL = `${ORIGIN}/api/v1/jobs/${JOB_ID}/source`;

function ticketValue(uploadUrl: string): Record<string, string> {
  return {
    jobId: JOB_ID,
    uploadTicket: "upload-token-1234567890",
    jobTicket: "job-token-1234567890",
    uploadUrl,
    expiresAt: "2026-08-11T10:00:00.000Z",
  };
}

function headers(init: RequestInit | undefined): Headers {
  return new Headers(init?.headers);
}

function inputUrl(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.toString();
  if (typeof input === "string") return input;
  return input.url;
}

function zip(
  entries: ReadonlyArray<readonly [name: string, value: string]>,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const archive = new yazl.ZipFile();
    const chunks: Buffer[] = [];
    archive.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.outputStream.once("error", reject);
    archive.outputStream.once("end", () =>
      resolve(new Uint8Array(Buffer.concat(chunks))),
    );
    for (const [name, value] of entries)
      archive.addBuffer(Buffer.from(value), name);
    archive.end();
  });
}
