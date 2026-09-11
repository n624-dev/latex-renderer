import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { downloadPublishedRelease } from "../deploy/scripts/published-release.mjs";

const stages: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(
    stages.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

// Synthetic, unsigned JWT-shaped input: never a real credential. Generate its
// encoded segments from readable fixture data instead of storing a token literal.
const fixtureJwt = [
  Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url"),
  Buffer.from(JSON.stringify({ sub: "fixture" })).toString("base64url"),
  "fixture-signature_123",
].join(".");

it.each([
  undefined,
  "github_ci_test_token",
  fixtureJwt,
  "fixture-._~+/0123456789==",
])(
  "scopes explicit API authentication (%s) to metadata, never asset downloads",
  async (apiToken) => {
    const stage = await mkdtemp(join(tmpdir(), "published-release-test-"));
    stages.push(stage);
    vi.stubEnv("GH_TOKEN", "must_not_be_used");
    vi.stubEnv("GITHUB_TOKEN", "must_not_be_used_either");
    const bytes = Buffer.from("fixture");
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const assetUrl =
      "https://github.com/n624-dev/latex-renderer/releases/download/v1.3.4-rc.5/latex-renderer-server-1.3.4-rc.5.tar.gz";
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, options: RequestInit) => {
        calls.push(url);
        if (url === assetUrl) {
          expect(options.headers).toBeUndefined();
          return new Response(bytes);
        }
        expect(new URL(url).origin).toBe("https://api.github.com");
        expect(options.redirect).toBe("error");
        expect(new Headers(options.headers).get("Authorization")).toBe(
          apiToken ? `Bearer ${apiToken}` : null,
        );
        if (url.includes("/releases/tags/"))
          return Response.json({
            draft: false,
            immutable: true,
            tag_name: "v1.3.4-rc.5",
            prerelease: true,
            assets: [
              {
                name: "latex-renderer-server-1.3.4-rc.5.tar.gz",
                browser_download_url: assetUrl,
                digest,
                size: bytes.length,
              },
            ],
          });
        if (url.includes("/git/ref/"))
          return Response.json({
            object: { type: "tag", sha: "a".repeat(40) },
          });
        if (url.includes("/git/tags/"))
          return Response.json({
            object: { type: "commit", sha: "b".repeat(40) },
          });
        // Stop before privileged verification; proof remains mandatory.
        return Response.json({ attestations: [] });
      }),
    );
    await expect(
      downloadPublishedRelease("v1.3.4-rc.5", stage, { apiToken }),
    ).rejects.toThrow("Release attestation missing");
    expect(calls).toHaveLength(5);
    expect(calls[4]).toContain("/attestations/");
  },
);

it("reports only bounded numeric API failure diagnostics and stops immediately", async () => {
  const fetch = vi.fn(
    () =>
      new Response("secret response body", {
        status: 403,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1234567890",
          "retry-after": "secret response header",
        },
      }),
  );
  vi.stubGlobal("fetch", fetch);
  await expect(
    downloadPublishedRelease("1.3.4-rc.5", "/unused", {
      apiToken: "secret_token",
    }),
  ).rejects.toThrow(
    "Release request failed: HTTP 403 (x-ratelimit-remaining=0, x-ratelimit-reset=1234567890)",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("rejects API redirects without requesting the external destination", async () => {
  const fetch = vi.fn((_url: string, options: RequestInit) => {
    expect(options.redirect).toBe("error");
    return new Response(null, {
      status: 302,
      headers: { location: "https://untrusted.invalid/" },
    });
  });
  vi.stubGlobal("fetch", fetch);
  await expect(
    downloadPublishedRelease("1.3.4", "/unused", { apiToken: "ci_token" }),
  ).rejects.toThrow("HTTP 302");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([
  "bad\r\nheader",
  "",
  "bad token",
  "bad\n",
  "bad\r",
  "bad\t",
  "bad\0token",
  "bad\u007ftoken",
  "非ASCII",
  "=",
  "bad=middle",
  "bad:token",
])(
  "rejects malformed explicit credentials before network access",
  async (apiToken) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      downloadPublishedRelease("1.3.4", "/unused", { apiToken }),
    ).rejects.toThrow("Invalid release API credential");
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("both E2E workflows pass only the named environment variable across sudo, consumed before children run", async () => {
  for (const name of ["server-release", "server-update-validation"]) {
    const workflow = await readFile(`.github/workflows/${name}.yml`, "utf8");
    expect(workflow).toContain("CI_RELEASE_GITHUB_TOKEN: ${{ github.token }}");
    expect(workflow).toContain(
      "sudo --preserve-env=CI_RELEASE_GITHUB_TOKEN env RUNNER_ENVIRONMENT=",
    );
    expect(workflow).not.toContain("$CI_RELEASE_GITHUB_TOKEN");
  }
  const entry = await readFile("deploy/ci/update-e2e.mjs", "utf8");
  expect(
    entry.indexOf("delete process.env.CI_RELEASE_GITHUB_TOKEN;"),
  ).toBeLessThan(entry.indexOf("const run ="));
  expect(entry).toMatch(
    /downloadPublishedRelease\(baselineTag, oldStage,\s*\{\s*apiToken/,
  );
});
