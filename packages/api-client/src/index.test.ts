import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RendererClient } from "./index.js";

afterEach(() => vi.unstubAllGlobals());

describe("RendererClient cache safety", () => {
  it("cache-busts job status requests and asks every cache layer not to store them", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        Response.json({
          id: "job_0123456789abcdef0123456789abcdef",
          status: "running",
          sourceSize: 10,
          sourceSha256: "a".repeat(64),
          createdAt: "2026-08-08T00:00:00.000Z",
          updatedAt: "2026-08-08T00:00:01.000Z",
          errorCode: null,
          errorMessage: null,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new RendererClient("https://gateway.example", "lrk_test", {
      trustedRendererOrigins: ["https://renderer.example"],
    });
    const job = await client.job(
      "https://renderer.example",
      "job_0123456789abcdef0123456789abcdef",
      "ticket",
    );

    expect(job).toMatchObject({
      retentionExpiresAt: null,
      artifacts: [],
      previews: [],
    });

    const [input, init] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(input.searchParams.get("fresh")).toMatch(/^\d+-[0-9a-f-]{36}$/);
    expect(init.cache).toBe("no-store");
    expect(new Headers(init.headers).get("Cache-Control")).toBe("no-store");
    expect(new Headers(init.headers).get("Pragma")).toBe("no-cache");
  });

  it("cache-busts artifact downloads", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(new Uint8Array([1, 2, 3]))),
    );
    vi.stubGlobal("fetch", fetchMock);
    const root = await mkdtemp(join(tmpdir(), "latex-renderer-api-client-"));
    const destination = join(root, "result.pdf");
    try {
      const client = new RendererClient("https://gateway.example", "lrk_test", {
        trustedRendererOrigins: ["https://renderer.example"],
      });
      await client.download(
        "https://renderer.example/v1/jobs/job_test/artifacts/result.pdf",
        "ticket",
        destination,
      );
      const [input, init] = fetchMock.mock.calls[0] as unknown as [
        URL,
        RequestInit,
      ];
      expect(input.searchParams.has("fresh")).toBe(true);
      expect(init.cache).toBe("no-store");
      expect(await readFile(destination)).toEqual(Buffer.from([1, 2, 3]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses Source plus entrypoint without re-uploading a deduplication hit", async () => {
    const sourceId = "source_0123456789abcdef0123456789abcdef",
      fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            sourceId,
            uploadRequired: false,
            expiresAt: "2026-08-12T00:00:00.000Z",
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            jobId: "job_0123456789abcdef0123456789abcdef",
            jobTicket: "job-ticket-value",
            expiresAt: "2026-08-12T00:00:00.000Z",
          }),
        );
    vi.stubGlobal("fetch", fetchMock);
    const client = new RendererClient("https://gateway.example", "lrk_test"),
      source = await client.createSource(
        42,
        "a".repeat(64),
        "source-key-123456",
      ),
      job = await client.createSourceJob(
        source.sourceId,
        "chapters/report.tex",
        "render-key-123456",
      );
    await client.uploadSource(source, "/not/read.zip", 42);

    expect(job.jobId).toBe("job_0123456789abcdef0123456789abcdef");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [sourceUrl, sourceInit] = fetchMock.mock.calls[0] as unknown as [
        URL,
        RequestInit,
      ],
      [renderUrl, renderInit] = fetchMock.mock.calls[1] as unknown as [
        URL,
        RequestInit,
      ];
    expect(sourceUrl.pathname).toBe("/api/v1/source-tickets");
    expect(renderUrl.pathname).toBe("/api/v1/render-tickets");
    expect(typeof sourceInit.body).toBe("string");
    expect(JSON.parse(sourceInit.body as string)).toEqual({
      size: 42,
      sha256: "a".repeat(64),
    });
    expect(typeof renderInit.body).toBe("string");
    expect(JSON.parse(renderInit.body as string)).toEqual({
      sourceId,
      entrypoint: "chapters/report.tex",
      outputs: ["pdf"],
    });
    expect(JSON.stringify(source)).not.toContain("ticket-value");
  });

  it("rejects insecure API origins except loopback development URLs", () => {
    expect(
      () => new RendererClient("http://gateway.example", "lrk_test"),
    ).toThrow(/HTTPS/);
    expect(
      () => new RendererClient("http://127.0.0.1:3100", "lrk_test"),
    ).not.toThrow();
    expect(
      () => new RendererClient("http://[::1]:3100", "lrk_test"),
    ).not.toThrow();
  });

  it("does not send bearer tickets to an untrusted artifact origin", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const root = await mkdtemp(join(tmpdir(), "latex-renderer-api-client-"));
    try {
      const client = new RendererClient("https://gateway.example", "lrk_test");
      await expect(
        client.download(
          "https://untrusted.example/result.pdf",
          "job-ticket",
          join(root, "result.pdf"),
        ),
      ).rejects.toMatchObject({ code: "UNTRUSTED_CREDENTIAL_ORIGIN" });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not send upload tickets to an origin injected into a response", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = new RendererClient("https://gateway.example", "lrk_test");
    await expect(
      client.upload(
        {
          jobId: "job_0123456789abcdef0123456789abcdef",
          uploadTicket: "upload-ticket-value",
          jobTicket: "job-ticket-value",
          uploadUrl: "https://untrusted.example/upload",
          expiresAt: "2026-08-12T00:00:00.000Z",
        },
        "/not/read.zip",
        1,
      ),
    ).rejects.toMatchObject({ code: "UNTRUSTED_CREDENTIAL_ORIGIN" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
