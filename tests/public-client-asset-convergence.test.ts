import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForPublishedClientAssets } from "../deploy/scripts/verify-public-client-assets.mjs";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("published client asset convergence", () => {
  it("retries when a new manifest is served before its archive", async () => {
    const fixture = createFixture();
    const responses = [
      jsonResponse(fixture.manifest),
      archiveResponse(fixture.oldArchive),
      jsonResponse(fixture.manifest),
      archiveResponse(fixture.archive),
    ];
    const fetchImpl = vi.fn(() =>
      Promise.resolve(responses.shift() ?? new Response(null, { status: 500 })),
    );
    const sleep = vi.fn(() => Promise.resolve());

    const hash = await waitForPublishedClientAssets({
      clientBaseUrl: "https://latex-render.example/downloads/client",
      localManifestPath: fixture.manifestPath,
      archiveOutputPath: fixture.outputPath,
      releaseId: "release-test",
      attempts: 2,
      retryDelayMs: 0,
      fetchImpl,
      sleep,
    });

    expect(hash).toBe(fixture.manifest.sha256);
    expect(readFileSync(fixture.outputPath)).toEqual(fixture.archive);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("does not accept a mutually consistent but stale manifest and archive", async () => {
    const fixture = createFixture();
    const oldManifest = manifestFor(fixture.oldArchive);
    const responses = [
      jsonResponse(oldManifest),
      jsonResponse(fixture.manifest),
      archiveResponse(fixture.archive),
    ];
    const fetchImpl = vi.fn(() =>
      Promise.resolve(responses.shift() ?? new Response(null, { status: 500 })),
    );

    await expect(
      waitForPublishedClientAssets({
        clientBaseUrl: "https://latex-render.example/downloads/client",
        localManifestPath: fixture.manifestPath,
        archiveOutputPath: fixture.outputPath,
        releaseId: "release-test",
        attempts: 2,
        retryDelayMs: 0,
        fetchImpl,
        sleep: () => Promise.resolve(),
      }),
    ).resolves.toBe(fixture.manifest.sha256);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("fails clearly when assets never converge", async () => {
    const fixture = createFixture();
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 503 })),
    );
    await expect(
      waitForPublishedClientAssets({
        clientBaseUrl: "https://latex-render.example/downloads/client",
        localManifestPath: fixture.manifestPath,
        archiveOutputPath: fixture.outputPath,
        releaseId: "release-test",
        attempts: 2,
        retryDelayMs: 0,
        fetchImpl,
        sleep: () => Promise.resolve(),
      }),
    ).rejects.toThrow("did not converge after 2 attempts");
  });
});

function createFixture(): {
  archive: Buffer;
  oldArchive: Buffer;
  manifest: ReturnType<typeof manifestFor>;
  manifestPath: string;
  outputPath: string;
} {
  const root = mkdtempSync(join(tmpdir(), "latex-renderer-assets-"));
  roots.push(root);
  const archive = Buffer.from("new client archive");
  const oldArchive = Buffer.from("old client archive");
  const manifest = manifestFor(archive);
  const manifestPath = join(root, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return {
    archive,
    oldArchive,
    manifest,
    manifestPath,
    outputPath: join(root, "download.zip"),
  };
}

function manifestFor(archive: Buffer): {
  archive: string;
  sha256: string;
  size: number;
} {
  return {
    archive: "latex-renderer-client-0.2.0.zip",
    sha256: createHash("sha256").update(archive).digest("hex"),
    size: archive.byteLength,
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
}

function archiveResponse(value: Buffer): Response {
  return new Response(Uint8Array.from(value).buffer);
}
