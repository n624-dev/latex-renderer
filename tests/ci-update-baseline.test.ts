import { createServer, request } from "node:https";
import { once } from "node:events";
import { afterAll, beforeAll, afterEach, expect, it, vi } from "vitest";
import {
  acquireUpdateBaseline,
  updateBaselineTag,
} from "../deploy/ci/update-baseline.mjs";
import { baselineFailureIdentity } from "../deploy/ci/baseline-transport-diagnostics.mjs";
import { ingressTlsFixture } from "./fixtures/server-ingress.js";

const baseline = {
  source: "/fixture/verified",
  version: "1.3.4-rc.5",
  commit: "a".repeat(40),
};
const options = {
  variant: "legacy",
  architecture: "x64",
  stage: "/fixture",
  apiToken: "ci_fixture",
  run: vi.fn(),
};
afterEach(() => {
  vi.restoreAllMocks();
});

it.each([
  ["legacy", "x64", "v1.3.4-rc.5"],
  ["installed", "x64", "v1.3.5-rc.1"],
  ["native-arm64", "arm64", "v1.5.0-rc.1"],
])("retains the verified historical baseline for %s", (variant, arch, tag) => {
  expect(updateBaselineTag(variant, arch)).toBe(tag);
});
it.each([
  ["legacy", "arm64"],
  ["native-arm64", "x64"],
  ["__proto__", "x64"],
])(
  "rejects unsupported identity before acquisition or activation (%s/%s)",
  async (variant, architecture) => {
    const download = vi.fn(),
      activateHttps = vi.fn();
    await expect(
      acquireUpdateBaseline(
        { ...options, variant, architecture },
        { download, activateHttps },
      ),
    ).rejects.toThrow();
    expect(download).not.toHaveBeenCalled();
    expect(activateHttps).not.toHaveBeenCalled();
  },
);
it("does not activate HTTPS while verification is pending", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  let release: ((value: typeof baseline) => void) | undefined;
  const pending = new Promise<typeof baseline>((resolve) => {
    release = resolve;
  });
  const activateHttps = vi.fn().mockResolvedValue(undefined);
  const operation = acquireUpdateBaseline(options, {
    download: () => pending,
    activateHttps,
  });
  await Promise.resolve();
  expect(activateHttps).not.toHaveBeenCalled();
  if (!release) throw new Error("Missing pending verification resolver");
  release(baseline);
  await expect(operation).resolves.toEqual({
    baseline,
    baselineTag: "v1.3.4-rc.5",
  });
  expect(activateHttps).toHaveBeenCalledOnce();
});
it.each([
  "Release checksum mismatch",
  "Release attestation missing",
  "TLS identity mismatch",
])("does not enable the fixture or retry after %s", async (message) => {
  const failure = new Error(message),
    download = vi.fn().mockRejectedValue(failure);
  const activateHttps = vi.fn(),
    reportFailure = vi.fn().mockRejectedValue(new Error("diagnostic failed"));
  await expect(
    acquireUpdateBaseline(options, { download, activateHttps, reportFailure }),
  ).rejects.toBe(failure);
  expect(download).toHaveBeenCalledOnce();
  expect(activateHttps).not.toHaveBeenCalled();
  expect(reportFailure).toHaveBeenCalledWith(failure);
});
it("does not start any work without the explicitly supplied CI credential", async () => {
  const download = vi.fn(),
    activateHttps = vi.fn();
  await expect(
    acquireUpdateBaseline(
      { ...options, apiToken: undefined },
      { download, activateHttps },
    ),
  ).rejects.toThrow("read-only API token");
  expect(download).not.toHaveBeenCalled();
  expect(activateHttps).not.toHaveBeenCalled();
});
it("restricts failure identity to known codes and certificate categories", () => {
  const secret = "must_not_appear_in_diagnostics";
  const result = baselineFailureIdentity({
    message: secret,
    headers: { Authorization: secret },
    cause: {
      code: "ERR_TLS_CERT_ALTNAME_INVALID",
      message: secret,
      cert: {
        subjectaltname: "DNS:latex-renderer-ci.test",
        privateKey: secret,
      },
    },
  });
  expect(result).toEqual({
    codes: ["ERR_TLS_CERT_ALTNAME_INVALID"],
    certificate: "ci-fixture",
  });
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(
    baselineFailureIdentity({ code: secret, cert: { subjectaltname: secret } }),
  ).toEqual({ codes: [], certificate: "other" });
});

// Real TLS hostname verification, without external network, sudo or host edits.
// The injected route switches to the local fixture when it is activated. The
// old activation-first order rejects exactly the wrong certificate observed in
// CI; acquisition-first succeeds without accepting that certificate for GitHub.
const github = ingressTlsFixture({ subjectAltName: "DNS:api.github.com" });
const local = ingressTlsFixture({
  subjectAltName: "DNS:latex-renderer-ci.test",
});
let localRequests = 0;
const upstream = createServer(
  { cert: github.certificate, key: github.key },
  (_req, res) => res.end("verified fixture"),
);
const fixture = createServer(
  { cert: local.certificate, key: local.key },
  (_req, res) => {
    localRequests++;
    res.end("local fixture");
  },
);
beforeAll(async () => {
  upstream.listen(0, "127.0.0.1");
  fixture.listen(0, "127.0.0.1");
  await Promise.all([once(upstream, "listening"), once(fixture, "listening")]);
});
afterAll(async () => {
  await Promise.all([
    new Promise<void>((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve())),
    ),
    new Promise<void>((resolve, reject) =>
      fixture.close((error) => (error ? reject(error) : resolve())),
    ),
  ]);
  github.cleanup();
  local.cleanup();
});
it("reproduces a fixture certificate mix-up in the old order and prevents it with the actual acquisition stage", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  let fixtureActive = true;
  async function download() {
    const server = fixtureActive ? fixture : upstream,
      address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing fixture port");
    await new Promise<void>((resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port: address.port,
          servername: "api.github.com",
          ca: [github.certificate, local.certificate],
          rejectUnauthorized: true,
          agent: false,
          headers: { Authorization: "Bearer ci_fixture" },
        },
        (response) => {
          response.resume();
          response.on("end", resolve);
          response.on("error", reject);
        },
      );
      req.on("error", reject);
      req.end();
    });
    return baseline;
  }
  await expect(download()).rejects.toHaveProperty(
    "code",
    "ERR_TLS_CERT_ALTNAME_INVALID",
  );
  fixtureActive = false;
  await expect(
    acquireUpdateBaseline(options, {
      download,
      activateHttps: () => {
        fixtureActive = true;
        return Promise.resolve();
      },
    }),
  ).resolves.toEqual({ baseline, baselineTag: "v1.3.4-rc.5" });
  expect(fixtureActive).toBe(true);
  expect(localRequests).toBe(0); // The mismatched TLS peer never receives Authorization.
});
