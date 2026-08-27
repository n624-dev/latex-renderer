import { describe, expect, it, vi } from "vitest";
import { verifyGhcrWriteAccess } from "../deploy/scripts/verify-ghcr-write-access.mjs";

const repository = "ghcr.io/n624-dev/latex-renderer-texlive";
const configDigest = `sha256:${"a".repeat(64)}`;

function tokenResponse(): Response {
  return new Response(JSON.stringify({ token: "opaque-registry-token" }), {
    status: 200,
  });
}

function manifestResponse(): Response {
  return new Response(JSON.stringify({ config: { digest: configDigest } }), {
    status: 200,
  });
}

describe("GHCR publication access preflight", () => {
  it("rejects a denied same-repository mount with actionable guidance", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(manifestResponse())
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));

    await expect(verifyGhcrWriteAccess({
      repository,
      actor: "github-actions",
      token: "not-a-real-secret",
      fetchImpl: fetchMock,
    })).rejects.toThrow(/Manage Actions access.*Write role/);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("mounts only an existing blob from and into the exact target repository", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(manifestResponse())
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));

    await expect(verifyGhcrWriteAccess({
      repository,
      actor: "github-actions",
      token: "not-a-real-secret",
      fetchImpl: fetchMock,
    })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "HEAD" });
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      `https://ghcr.io/v2/n624-dev/latex-renderer-texlive/blobs/uploads/?mount=${encodeURIComponent(configDigest)}&from=n624-dev%2Flatex-renderer-texlive`,
    );
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({ method: "POST" });
  });

  it("refuses a malformed manifest before attempting any write", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        config: { digest: "sha256:not-a-digest" },
      }), { status: 200 }));

    await expect(verifyGhcrWriteAccess({
      repository,
      actor: "github-actions",
      token: "not-a-real-secret",
      fetchImpl: fetchMock,
    })).rejects.toThrow("valid config digest");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
