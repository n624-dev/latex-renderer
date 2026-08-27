import { describe, expect, it, vi } from "vitest";
import {
  hasRepositoryAction,
  registryAccessClaims,
  verifyGhcrWriteAccess,
} from "../deploy/scripts/verify-ghcr-write-access.mjs";

function registryToken(access: unknown): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ access })}.signature`;
}

describe("GHCR publication access preflight", () => {
  it("accepts only a push grant for the exact target repository", () => {
    const claims = registryAccessClaims(registryToken([
      { type: "repository", name: "n624-dev/other", actions: ["pull", "push"] },
      { type: "repository", name: "n624-dev/latex-renderer-texlive", actions: ["pull", "push"] },
    ]));
    expect(hasRepositoryAction(claims, "n624-dev/latex-renderer-texlive", "push")).toBe(true);
    expect(hasRepositoryAction(claims, "n624-dev/missing", "push")).toBe(false);
  });

  it("rejects pull-only workflow access with actionable package-setting guidance", async () => {
    const fetchMock = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(new Response(JSON.stringify({
        token: registryToken([
          { type: "repository", name: "n624-dev/latex-renderer-texlive", actions: ["pull"] },
        ]),
      }), { status: 200 }));
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;

    await expect(verifyGhcrWriteAccess({
      repository: "ghcr.io/n624-dev/latex-renderer-texlive",
      actor: "github-actions",
      token: "not-a-real-secret",
      fetchImpl,
    })).rejects.toThrow(/Manage Actions access.*Write role/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("completes without attempting a registry mutation when push is granted", async () => {
    const fetchMock = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(new Response(JSON.stringify({
        token: registryToken([
          { type: "repository", name: "n624-dev/latex-renderer-texlive", actions: ["pull", "push"] },
        ]),
      }), { status: 200 }));
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;

    await expect(verifyGhcrWriteAccess({
      repository: "ghcr.io/n624-dev/latex-renderer-texlive",
      actor: "github-actions",
      token: "not-a-real-secret",
      fetchImpl,
    })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("method");
  });
});
