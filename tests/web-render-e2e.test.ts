import { afterEach, describe, expect, it, vi } from "vitest";
import yazl from "yazl";
import {
  createAdminRenderTicket,
  fetchRenderArtifact,
  fetchRenderJob,
  inspectZip,
  sha256Hex,
  uploadRenderZip,
  type BrowserJobArtifact,
  type RenderFetch,
} from "../apps/admin-web/src/assets/render-script.js";

afterEach(() => vi.restoreAllMocks());

describe("Web render sample ZIP E2E", () => {
  it("runs ticket, direct upload, status, preview, and artifact download without logging credentials", async () => {
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const source = await zip([
      [
        "main.tex",
        "\\documentclass{article}\n\\begin{document}E2E\\end{document}\n",
      ],
    ]);
    expect(inspectZip(source)).toEqual({ entries: 1, files: 1, mainTex: true });
    const sourceSha256 = await sha256Hex(source);
    const outputs = {
      "result.pdf": new TextEncoder().encode("%PDF-1.7\nE2E\n"),
      "compile.log": new TextEncoder().encode("Output written on result.pdf\n"),
      "errors.json": new TextEncoder().encode(
        '{"success":true,"exitCode":0,"errors":[],"warnings":[]}\n',
      ),
      "page-1.png": new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]),
    };
    const artifacts = await Promise.all([
      artifact("pdf", "result.pdf", outputs["result.pdf"]),
      artifact("log", "compile.log", outputs["compile.log"]),
      artifact("errors", "errors.json", outputs["errors.json"]),
    ]);
    const previews = [
      await artifact("preview", "previews/page-1.png", outputs["page-1.png"]),
    ];
    let uploaded: Uint8Array | undefined;
    let statusRequests = 0;
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const fetcher: RenderFetch = async (input, init) => {
      const url = inputUrl(input);
      const authorization = new Headers(init?.headers).get("Authorization");
      requests.push({ url, authorization });
      const parsed = new URL(url);
      if (parsed.pathname === "/admin/api/v1/jobs/render-tickets") {
        return Response.json(
          {
            jobId: JOB_ID,
            uploadTicket: UPLOAD_TICKET,
            jobTicket: JOB_TICKET,
            uploadUrl: `${ORIGIN}/api/v1/jobs/${JOB_ID}/source`,
            expiresAt: "2026-08-11T11:00:00.000Z",
          },
          { status: 201 },
        );
      }
      if (parsed.pathname.endsWith("/source")) {
        expect(authorization).toBe(`Bearer ${UPLOAD_TICKET}`);
        expect(init?.body).toBeInstanceOf(File);
        uploaded = new Uint8Array(await (init?.body as File).arrayBuffer());
        return new Response(null, { status: 204 });
      }
      if (parsed.pathname === `/api/v1/jobs/${JOB_ID}`) {
        expect(authorization).toBe(`Bearer ${JOB_TICKET}`);
        statusRequests += 1;
        return Response.json({
          id: JOB_ID,
          status: statusRequests === 1 ? "queued" : "succeeded",
          errorCode: null,
          errorMessage: null,
          retentionExpiresAt:
            statusRequests === 1 ? null : "2026-08-12T10:00:00.000Z",
          artifacts: statusRequests === 1 ? [] : artifacts,
          previews: statusRequests === 1 ? [] : previews,
        });
      }
      const name = decodeURIComponent(parsed.pathname.split("/").at(-1) ?? "");
      if (name in outputs) {
        const output = outputs[name as keyof typeof outputs];
        expect(authorization).toBe(`Bearer ${JOB_TICKET}`);
        return new Response(output);
      }
      return Response.json(
        { error: { code: "NOT_FOUND", message: "missing" } },
        { status: 404 },
      );
    };

    const file = new File([source.slice().buffer], "sample.zip", {
      type: "application/zip",
    });
    const ticket = await createAdminRenderTicket(
      fetcher,
      ORIGIN,
      API_KEY_ID,
      file.size,
      sourceSha256,
      "web-e2e-1234567890123456",
    );
    await uploadRenderZip(fetcher, ticket, file);
    expect(uploaded).toEqual(source);
    await expect(
      fetchRenderJob(fetcher, ORIGIN, JOB_ID, JOB_TICKET),
    ).resolves.toMatchObject({ status: "queued" });
    const completed = await fetchRenderJob(fetcher, ORIGIN, JOB_ID, JOB_TICKET);
    expect(completed).toMatchObject({
      status: "succeeded",
      retentionExpiresAt: "2026-08-12T10:00:00.000Z",
    });
    const pdf = completed.artifacts.find(
      (item) => item.relativePath === "result.pdf",
    );
    const preview = completed.previews[0];
    const errors = completed.artifacts.find(
      (item) => item.relativePath === "errors.json",
    );
    expect(pdf).toBeDefined();
    expect(preview).toBeDefined();
    expect(errors).toBeDefined();
    await expect(
      fetchRenderArtifact(
        fetcher,
        ORIGIN,
        JOB_TICKET,
        pdf as BrowserJobArtifact,
      ),
    ).resolves.toHaveProperty("size", outputs["result.pdf"].byteLength);
    await expect(
      fetchRenderArtifact(
        fetcher,
        ORIGIN,
        JOB_TICKET,
        preview as BrowserJobArtifact,
      ),
    ).resolves.toHaveProperty("size", outputs["page-1.png"].byteLength);
    const errorsBlob = await fetchRenderArtifact(
      fetcher,
      ORIGIN,
      JOB_TICKET,
      errors as BrowserJobArtifact,
    );
    await expect(errorsBlob.text()).resolves.toContain('"success":true');

    expect(requests[0]).toMatchObject({ authorization: null });
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});

const ORIGIN = "https://latex.example.com";
const JOB_ID = "job_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const API_KEY_ID = "key_e2e";
const UPLOAD_TICKET = "upload-ticket-e2e-1234567890";
const JOB_TICKET = "job-ticket-e2e-1234567890";

async function artifact(
  type: string,
  relativePath: string,
  bytes: Uint8Array,
): Promise<BrowserJobArtifact> {
  const preview = type === "preview";
  const leaf = preview ? relativePath.slice("previews/".length) : relativePath;
  return {
    type,
    relativePath,
    size: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    createdAt: "2026-08-11T10:00:00.000Z",
    downloadUrl: `/api/v1/jobs/${JOB_ID}/${preview ? "previews" : "artifacts"}/${encodeURIComponent(leaf)}`,
  };
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
