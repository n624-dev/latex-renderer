import { Script, runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  parseJobStatus,
  parseRenderTicket,
  renderScript,
  runBoundedBatch,
  sha256Hex,
  uploadRenderZip,
  zipSingleTex,
  zipStoredFiles,
  withAdminJobTicket,
  type RenderFetch,
} from "../apps/admin-web/src/assets/render-script.js";
import { adminRenderPage } from "../apps/admin-web/src/templates-admin.js";
import { appScript } from "../apps/admin-web/src/assets/app-script.js";

afterEach(() => vi.restoreAllMocks());

describe("admin batch bearer renewal", () => {
  it("uses a newly authenticated session's CSRF token without resubmitting a Job", async () => {
    const access = {
      jobId: `job_${"a".repeat(32)}`,
      jobTicket: "old",
      expiresAt: "2000-01-01T00:00:00Z",
    };
    const used: string[] = [];
    const fetcher: RenderFetch = (url, init) => {
      if (String(url).endsWith("/auth/session"))
        return Promise.resolve(Response.json({ csrfToken: "new-csrf" }));
      const csrf = new Headers(init?.headers).get("X-CSRF-Token");
      if (csrf === null) throw new Error("Missing fixture CSRF header");
      used.push(csrf);
      return Promise.resolve(
        csrf === "new-csrf"
          ? Response.json({
              jobId: access.jobId,
              jobTicket: "new",
              expiresAt: "2099-01-01T00:00:00Z",
            })
          : Response.json(
              { error: { code: "CSRF_TOKEN_REQUIRED" } },
              { status: 403 },
            ),
      );
    };
    await withAdminJobTicket(
      fetcher,
      "https://renderer.invalid",
      "old-csrf",
      access,
      (ticket) => {
        expect(ticket).toBe("new");
        return Promise.resolve();
      },
    );
    expect(used).toEqual(["old-csrf", "new-csrf"]);
  });
  it.each([1799, 1800, 1801])(
    "renews at the server expiry boundary (%s seconds)",
    async (elapsed) => {
      const base = Date.parse("2026-10-22T00:00:00.000Z");
      vi.spyOn(Date, "now").mockReturnValue(base + elapsed * 1000);
      const access = {
        jobId: `job_${"a".repeat(32)}`,
        jobTicket: "old",
        expiresAt: new Date(base + 1800_000).toISOString(),
      };
      const fetcher = vi.fn<RenderFetch>().mockImplementation(() =>
        Promise.resolve(
          Response.json({
            jobId: access.jobId,
            jobTicket: "new",
            expiresAt: new Date(base + 3600_000).toISOString(),
          }),
        ),
      );
      const used: string[] = [];
      await withAdminJobTicket(
        fetcher,
        "https://renderer.invalid",
        "csrf",
        access,
        (ticket) => {
          used.push(ticket);
          return Promise.resolve();
        },
      );
      expect(used).toEqual([elapsed < 1800 ? "old" : "new"]);
      expect(fetcher).toHaveBeenCalledTimes(elapsed < 1800 ? 0 : 1);
    },
  );
  it("shares one renewal for polling, PDF/ZIP fetch and cancel, and bounds 401 retries", async () => {
    const access = { jobId: `job_${"a".repeat(32)}`, jobTicket: "old" };
    const fetcher = vi.fn<RenderFetch>().mockResolvedValue(
      Response.json({
        jobId: access.jobId,
        jobTicket: "new",
        expiresAt: "2099-01-01T00:00:00Z",
      }),
    );
    const attempts: string[] = [];
    await Promise.all(
      Array.from({ length: 4 }, () =>
        withAdminJobTicket(
          fetcher,
          "https://renderer.invalid",
          "csrf",
          access,
          (ticket) => {
            attempts.push(ticket);
            if (ticket === "old")
              return Promise.reject(
                Object.assign(new Error("expired"), { status: 401 }),
              );
            return Promise.resolve();
          },
        ),
      ),
    );
    expect(fetcher).toHaveBeenCalledOnce();
    expect(attempts.filter((ticket) => ticket === "new")).toHaveLength(4);
    const failures = vi
      .fn<(ticket: string) => Promise<void>>()
      .mockRejectedValue(
        Object.assign(new Error("still unauthorized"), { status: 401 }),
      );
    const second = vi.fn<RenderFetch>().mockResolvedValue(
      Response.json({
        jobId: access.jobId,
        jobTicket: "renewed-again",
        expiresAt: "2099-01-01T00:00:00Z",
      }),
    );
    await expect(
      withAdminJobTicket(
        second,
        "https://renderer.invalid",
        "csrf",
        access,
        failures,
      ),
    ).rejects.toThrow("still unauthorized");
    expect(failures).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledOnce();
  });
  it.each([401, 403, 410])(
    "does not bypass an unavailable admin session or retained artifact boundary (HTTP %s)",
    async (status) => {
      const access = {
        jobId: `job_${"a".repeat(32)}`,
        jobTicket: "old",
        expiresAt: "2000-01-01T00:00:00Z",
      };
      const fetcher = vi
        .fn<RenderFetch>()
        .mockResolvedValue(
          Response.json(
            { error: { code: "UNAVAILABLE", message: "Unavailable" } },
            { status },
          ),
        );
      const operation = vi
        .fn<(ticket: string) => Promise<void>>()
        .mockResolvedValue();
      await expect(
        withAdminJobTicket(
          fetcher,
          "https://renderer.invalid",
          "csrf",
          access,
          operation,
        ),
      ).rejects.toMatchObject({ status });
      expect(operation).not.toHaveBeenCalled();
      expect(access.jobTicket).toBe("old");
    },
  );
});

describe("Web render ZIP preflight", () => {
  it("validates per-output state and accepts only the three canonical SVG diagnostic paths", () => {
    const jobId = `job_${"a".repeat(32)}`,
      value = {
        id: jobId,
        status: "failed",
        errorCode: "SVG_GENERATION_FAILED",
        errorMessage: null,
        retentionExpiresAt: null,
        artifacts: [],
        previews: [],
        stages: {
          pdf: {
            status: "succeeded",
            sha256: "b".repeat(64),
            completedAt: "2026-10-19T00:00:00.000Z",
            errorCode: null,
            errorMessage: null,
          },
          svg: {
            status: "failed",
            attempt: 1,
            completedAt: "2026-10-19T00:00:01.000Z",
            errorCode: "SVG_GENERATION_FAILED",
            errorMessage: null,
          },
        },
      };
    expect(parseJobStatus(value, jobId).stages).toEqual(value.stages);
    for (const [type, path] of [
      ["log", "svg/compile.log"],
      ["errors", "svg/errors.json"],
      ["dependencies", "svg/dependencies.json"],
    ]) {
      const a = {
        type,
        relativePath: path,
        size: 1,
        sha256: "c".repeat(64),
        createdAt: "2026-10-19T00:00:01.000Z",
        downloadUrl: `/api/v1/jobs/${jobId}/artifacts/${path}`,
      };
      expect(parseJobArtifact(a, jobId, false)).toEqual(a);
      expect(() =>
        parseJobArtifact(
          { ...a, relativePath: "svg/../compile.log" },
          jobId,
          false,
        ),
      ).toThrow();
      expect(() =>
        parseJobArtifact({ ...a, type: "pdf" }, jobId, false),
      ).toThrow();
    }
    for (const stages of [
      null,
      [],
      { ...value.stages, svg: { ...value.stages.svg, attempt: 9 } },
      { ...value.stages, pdf: { ...value.stages.pdf, sha256: "invalid" } },
    ])
      expect(() => parseJobStatus({ ...value, stages }, jobId)).toThrow();
  });
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

  it.each(["reports/cafe\u0301.tex", "reports/caf\u00e9.tex"])(
    "preserves ZIP entrypoint spelling: %s",
    async (name) => {
      const archive = await zip([[name, "entrypoint"]]);
      expect(inspectZipCandidates(archive).texFiles).toEqual([name]);
    },
  );

  it("rejects an archive without a root main.tex", async () => {
    const bytes = await zip([["project/main.tex", "nested"]]);

    expect(() => inspectZip(bytes)).toThrow(
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

  it.each([
    ["App", appScript, "  (function installApp("],
    ["Admin", renderScript, "  fetch('/auth/session'"],
  ])(
    "embeds the resource-wait helper in the shipped %s script",
    (_name, script, startup) => {
      // Syntax checks and direct module calls do not detect omitted dependencies
      // in these serialized browser closures. Execute the actual emitted helper.
      const end = script.lastIndexOf(startup);
      expect(end).toBeGreaterThan(0);
      const context = { label: "" };
      runInNewContext(
        script.slice(0, end) +
          'globalThis.label = resourceWaitLabel({status:"queued",errorCode:"HOST_RESOURCE_WAIT",errorMessage:"700MiB / 704MiB"});})();',
        context,
      );
      expect(context.label).toContain("サーバー資源の空きを待っています");
      expect(context.label).toContain("704MiB");
    },
  );

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
        "csrf-test-token",
      ),
    ).resolves.toMatchObject({ sourceRef: `source_ref_${"a".repeat(32)}` });
    expect(requests[0]?.url).toBe(`${ORIGIN}/admin/api/v1/jobs/source-refs`);
    expect(requests[0]?.init?.credentials).toBe("same-origin");
    expect(headers(requests[0]?.init).get("X-CSRF-Token")).toBe(
      "csrf-test-token",
    );
  });

  it("rejects a ticket that would send the upload token off-origin", () => {
    expect(() =>
      parseRenderTicket(
        ticketValue(
          "https://attacker.example/api/v1/jobs/job_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/source",
        ),
        "https://latex.example.com",
      ),
    ).toThrow("ZIP送信先が公開Renderer APIと一致しません");
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
                userLabel: "owner@example.com",
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
      "csrf-test-token",
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
    expect(headers(renderRequest.init).get("X-CSRF-Token")).toBe(
      "csrf-test-token",
    );
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
