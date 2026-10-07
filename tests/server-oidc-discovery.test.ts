import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { createServer, request } from "node:https";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  discoverServerOidcProvider,
  serverOidcDiscoveryUrl,
  validateServerOidcMetadata,
  importServerSetupDeploymentReview,
  reviewServerSetupReadiness,
  checkServerSetupOidc,
} from "../packages/server-setup-core/src/index.mjs";
import { OidcClient } from "../packages/auth/src/oidc.js";
import { ingressTlsFixture } from "./fixtures/server-ingress.js";

vi.mock("node:https", { spy: true });

const issuer = "https://id.example.test/tenant";
const execFileAsync = promisify(execFile);
function metadata(expected = issuer) {
  return {
    issuer: expected,
    authorization_endpoint: `${expected}/authorize`,
    token_endpoint: `${expected}/token`,
    jwks_uri: `${expected}/jwks`,
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic"],
    provider_extra: "provider-fixture-marker",
  };
}
function review(mode = "password", deployment = "standalone") {
  return importServerSetupDeploymentReview(
    [
      `DEPLOYMENT_MODE=${deployment}`,
      "PUBLIC_ORIGIN=https://renderer.example.test",
      "RENDERER_PUBLIC_URL=https://renderer.example.test",
      `AUTH_MODE=${mode}`,
      ...(mode === "oidc"
        ? [`OIDC_ISSUER=${issuer}`, "OIDC_CLIENT_ID=fixture-client"]
        : []),
      ...(mode === "cloudflare-access"
        ? [
            "CLOUDFLARE_ACCESS_ISSUER=https://fixture.cloudflareaccess.com",
            `CLOUDFLARE_ADMIN_AUDIENCE=${"a".repeat(64)}`,
            `CLOUDFLARE_REMOTE_MCP_AUDIENCE=${"b".repeat(64)}`,
          ]
        : []),
    ].join("\n"),
  );
}

describe("shared runtime/setup OIDC discovery", () => {
  it.each([
    [
      "https://id.example.test",
      "https://id.example.test/.well-known/openid-configuration",
    ],
    [
      "https://id.example.test/",
      "https://id.example.test/.well-known/openid-configuration",
    ],
    [issuer, `${issuer}/.well-known/openid-configuration`],
    [`${issuer}/`, `${issuer}/.well-known/openid-configuration`],
  ])("preserves configured issuer identity %s", (configured, expected) => {
    expect(serverOidcDiscoveryUrl(configured)).toBe(expected);
    const checked = validateServerOidcMetadata(
      configured,
      metadata(configured),
    );
    expect(checked.issuer).toBe(configured);
    expect(Object.isFrozen(checked)).toBe(true);
    expect(checked).not.toHaveProperty("provider_extra");
    expect(() =>
      validateServerOidcMetadata(configured, {
        ...metadata(),
        issuer: configured + "/",
      }),
    ).toThrow(/exactly/);
  });

  it.each([
    "http://id.test",
    "https://user:secret@id.test",
    "https://id.test?secret=1",
    "https://id.test#fragment",
    "https://id.test\\tenant",
    " https://id.test",
    "https://id.test\n",
    "https://id.test/" + "a".repeat(2048),
  ])("rejects invalid issuer without network access %#", async (configured) => {
    const fetchImpl = vi.fn(() => Promise.resolve(Response.json(metadata())));
    await expect(
      discoverServerOidcProvider(configured, { fetchImpl }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["authorization_endpoint", "token_endpoint", "jwks_uri"])(
    "rejects unsafe %s",
    (key) => {
      for (const endpoint of [
        "http://id.test",
        "https://u:fixture-secret-marker@id.test",
        "https://id.test?token=fixture-secret-marker",
        "https://id.test#fragment",
        "https://id.test\\foo",
        undefined,
      ]) {
        const invalid = { ...metadata(), [key]: endpoint };
        expect(() => validateServerOidcMetadata(issuer, invalid)).toThrow(
          /HTTPS/,
        );
        try {
          validateServerOidcMetadata(issuer, invalid);
        } catch (error) {
          expect(String(error)).not.toContain("fixture-secret-marker");
        }
      }
    },
  );

  it("rejects unsupported login capabilities and injected array methods/getters", () => {
    for (const [key, value] of [
      ["response_types_supported", ["token"]],
      ["code_challenge_methods_supported", ["plain"]],
      ["token_endpoint_auth_methods_supported", ["none"]],
      ["response_types_supported", new Array(1)],
      ["response_types_supported", ["code", 1]],
      ["response_types_supported", Array.from({ length: 65 }, () => "code")],
    ])
      expect(() =>
        validateServerOidcMetadata(issuer, {
          ...metadata(),
          [String(key)]: value,
        }),
      ).toThrow(/support/);
    const getter = vi.fn(() => "code");
    const values: string[] = ["code"];
    Object.defineProperty(values, "0", { get: getter });
    expect(() =>
      validateServerOidcMetadata(issuer, {
        ...metadata(),
        response_types_supported: values,
      }),
    ).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const override = vi.fn(() => true);
    const injected = Object.assign(["token"], { includes: override });
    expect(() =>
      validateServerOidcMetadata(issuer, {
        ...metadata(),
        response_types_supported: injected,
      }),
    ).toThrow();
    expect(override).not.toHaveBeenCalled();
    const unknownGetter = { ...metadata() };
    Object.defineProperty(unknownGetter, "secret", { get: getter });
    expect(() => validateServerOidcMetadata(issuer, unknownGetter)).toThrow(
      /plain/,
    );
    expect(getter).not.toHaveBeenCalled();
  });

  it("keeps the standard client_secret_basic default and omits unrelated provider data", () => {
    const input: Record<string, unknown> = metadata();
    delete input.token_endpoint_auth_methods_supported;
    expect(validateServerOidcMetadata(issuer, input)).toEqual({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
    });
  });

  it("shares the exact setup/runtime policy without token or JWKS requests", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(Response.json(metadata())));
    const result = await checkServerSetupOidc(review("oidc"), { fetchImpl });
    expect(result.status).toBe("checked");
    const client = new OidcClient({
      issuer,
      clientId: "fixture-client",
      clientSecret: "fixture-client-secret",
      publicOrigin: "https://renderer.example.test",
      fetchImpl,
    });
    const authorization = await client.begin();
    await client.begin();
    expect(
      new URL(authorization.authorizationUrl).searchParams.get(
        "code_challenge_method",
      ),
    ).toBe("S256");
    expect(fetchImpl).toHaveBeenCalledTimes(2); // setup, then one cached runtime discovery
    for (const call of fetchImpl.mock.calls as unknown as [
      string,
      RequestInit,
    ][]) {
      expect(call[0]).toBe(serverOidcDiscoveryUrl(issuer));
      expect(call[1].redirect).toBe("error");
      expect(new Headers(call[1].headers).get("Authorization")).toBeNull();
      expect(call[1].signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("does not permanently cache a failed runtime discovery", async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        ++attempts === 1
          ? new Response("fixture-provider-secret", { status: 503 })
          : Response.json(metadata()),
      ),
    );
    const client = new OidcClient({
      issuer,
      clientId: "fixture-client",
      clientSecret: "fixture-client-secret",
      publicOrigin: "https://renderer.example.test",
      fetchImpl,
    });
    await expect(client.begin()).rejects.toThrow(/discovery failed/);
    await expect(client.begin()).resolves.toHaveProperty("state");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("preserves the runtime's existing global fetch transport", async () => {
    const fetchImpl = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(Response.json(metadata())));
    try {
      const client = new OidcClient({
        issuer,
        clientId: "fixture-client",
        clientSecret: "fixture-client-secret",
        publicOrigin: "https://renderer.example.test",
      });
      await expect(client.begin()).resolves.toHaveProperty("state");
      expect(fetchImpl).toHaveBeenCalledOnce();
    } finally {
      fetchImpl.mockRestore();
    }
  });

  it("does not expose a transport's raw exception", async () => {
    try {
      await discoverServerOidcProvider(issuer, {
        fetchImpl: () => Promise.reject(new Error("provider-fixture-secret")),
      });
      throw new Error("expected failure");
    } catch (error) {
      expect(String(error)).toContain("OIDC discovery failed;");
      expect(String(error)).not.toContain("provider-fixture-secret");
    }
  });

  it.each([
    () => new Response("provider-fixture-secret", { status: 302 }),
    () => new Response("provider-fixture-secret", { status: 500 }),
    () => new Response("[]"),
    () => new Response("invalid-provider-fixture-secret"),
    () => new Response(new Uint8Array([0xff])),
    () => new Response("{}", { headers: { "content-length": "65537" } }),
    () => new Response("{}", { headers: { "content-length": "NaN" } }),
    () => new Response("x".repeat(65537)),
    () => new Response(null, { status: 204 }),
    () => Response.json({ ...metadata(), issuer: issuer + "/" }),
  ])(
    "bounds invalid responses and sanitizes provider failures %#",
    async (response) => {
      await expect(
        discoverServerOidcProvider(issuer, {
          fetchImpl: () => Promise.resolve(response()),
        }),
      ).rejects.toThrow(/^OIDC discovery failed;/);
    },
  );

  it("bounds a fetch or body that stalls even if an injected transport ignores abort", async () => {
    await expect(
      discoverServerOidcProvider(issuer, {
        timeoutMs: 30,
        fetchImpl: () => new Promise<Response>(() => {}),
      }),
    ).rejects.toThrow(/discovery failed/);
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    await expect(
      discoverServerOidcProvider(issuer, {
        timeoutMs: 30,
        fetchImpl: () => Promise.resolve(new Response(stream)),
      }),
    ).rejects.toThrow(/discovery failed/);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("honors already-aborted caller signals without a request", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(Response.json(metadata())));
    await expect(
      discoverServerOidcProvider(issuer, {
        signal: AbortSignal.abort(),
        fetchImpl,
      }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
    for (const timeoutMs of [0, 10_001, NaN, 1.5]) {
      await expect(
        discoverServerOidcProvider(issuer, { timeoutMs, fetchImpl }),
      ).rejects.toThrow(/timeout/);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("explicitly enforces certificate validation for an actual untrusted HTTPS provider", async () => {
    const fixture = ingressTlsFixture();
    const server = createServer(
      { key: fixture.key, cert: fixture.certificate },
      (_req, res) => {
        res.end(JSON.stringify(metadata()));
      },
    );
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("No fixture port");
      vi.mocked(request).mockClear();
      await expect(
        discoverServerOidcProvider(`https://127.0.0.1:${address.port}`),
      ).rejects.toThrow(/discovery failed/);
      // Verify the actual transport's explicit policy, not Node's ambient
      // default, without weakening TLS globally in this test process.
      expect(request).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ rejectUnauthorized: true, agent: false }),
        expect.any(Function),
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      fixture.cleanup();
    }
  });

  it("uses normal extra-CA trust for actual HTTPS and bounds redirects, invalid statuses and large bodies", async () => {
    const fixture = ingressTlsFixture();
    let configured = "";
    let mode = "ok";
    const paths: string[] = [];
    const server = createServer(
      { key: fixture.key, cert: fixture.certificate },
      (req, res) => {
        paths.push(req.url ?? "");
        if (mode === "redirect") {
          res.writeHead(302, { Location: "/must-not-follow" });
          res.end();
        } else if (mode === "invalid-status") {
          res.writeHead(600);
          res.end();
        } else if (mode === "oversized") {
          res.end("x".repeat(65537));
        } else if (mode === "empty") {
          res.writeHead(204);
          res.end();
        } else res.end(JSON.stringify(metadata(configured)));
      },
    );
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("No fixture port");
      configured = `https://127.0.0.1:${address.port}/tenant`;
      const invoke = () =>
        execFileAsync(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            'import { discoverServerOidcProvider } from "./packages/server-setup-core/src/index.mjs"; console.log(JSON.stringify(await discoverServerOidcProvider(process.argv[1])));',
            configured,
          ],
          {
            env: {
              ...process.env,
              NODE_EXTRA_CA_CERTS: fixture.certificatePath,
            },
            timeout: 5000,
            maxBuffer: 8192,
          },
        );
      const result = await invoke();
      expect(JSON.parse(result.stdout) as unknown).toMatchObject({
        issuer: configured,
      });
      for (const failure of [
        "redirect",
        "invalid-status",
        "oversized",
        "empty",
      ]) {
        mode = failure;
        await expect(invoke()).rejects.toMatchObject({ code: 1 });
      }
      expect(paths).toEqual(
        Array.from(
          { length: 5 },
          () => "/tenant/.well-known/openid-configuration",
        ),
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      fixture.cleanup();
    }
  });
});

describe("shared non-secret setup readiness and CUI diagnostic", () => {
  it.each([
    ["password", "standalone"],
    ["cloudflare-access", "cloudflare"],
  ])("does not contact an OIDC provider for %s", async (mode, deployment) => {
    const fetchImpl = vi.fn(() => Promise.resolve(Response.json(metadata())));
    expect(
      await checkServerSetupOidc(review(mode, deployment), { fetchImpl }),
    ).toEqual({ status: "not-required", metadata: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retains the approved dual-method initial-owner plan without writing credentials", () => {
    const existing = review("oidc");
    const input = {
      ...existing,
      authentication: {
        ...existing.authentication,
        authentication: {
          backend: "native",
          passwordEnabled: true,
          oidcEnabled: true,
          oidc: {
            issuer,
            clientId: "fixture-client",
            allowedAlgorithms: ["RS256", "ES256"],
          },
        },
      },
    };
    const plan = reviewServerSetupReadiness(input);
    expect(plan.initialOwner).toEqual({
      bootstrapMethod: "password",
      followUpOidcRegistration: true,
    });
    expect(plan.requiredCredentialFiles.map((file) => file.id)).toEqual([
      "password-pepper",
      "oidc-client-secret",
    ]);
    expect(plan.readyForApply).toBe(false);
    expect(plan.ingressStatus).toBe("unreviewed");
    expect(Object.isFrozen(plan.requiredCredentialFiles)).toBe(true);
    expect(Object.isFrozen(plan.requiredCredentialFiles[0])).toBe(true);
  });

  it("marks unsupported automatic TLS instead of claiming readiness", () => {
    const ingress = {
      format: 1,
      mode: "standalone",
      accessScope: "local",
      publicOrigin: "https://renderer.example.test",
      tlsProvider: "automatic",
      listenAddress: "127.0.0.1",
    };
    const input = { ...review(), ingress };
    expect(reviewServerSetupReadiness(input)).toMatchObject({
      ingressStatus: "unsupported-automatic",
      readyForApply: false,
    });
    expect(
      reviewServerSetupReadiness({
        ...input,
        ingress: { ...ingress, tlsProvider: "custom" },
      }).requiredCredentialFiles.map((file) => file.id),
    ).toEqual(["password-pepper", "https-certificate", "https-private-key"]);
  });

  it("rejects credentials/invalid profile before any provider access", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(Response.json(metadata())));
    await expect(
      checkServerSetupOidc(
        { ...review("oidc"), password: "fixture-secret-marker" },
        { fetchImpl },
      ),
    ).rejects.toThrow(/unsupported/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("executes the source-only read-only CUI diagnostic without runtime dependencies", () => {
    const result = spawnSync(
      process.execPath,
      ["deploy/scripts/server-setup-review.mjs"],
      {
        input: JSON.stringify(review("oidc")),
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const plan = JSON.parse(result.stdout) as {
      readyForApply: boolean;
      oidcDiscoveryRequired: boolean;
      oidcDiscovery?: unknown;
    };
    expect(plan).toMatchObject({
      readyForApply: false,
      oidcDiscoveryRequired: true,
    });
    expect(plan).not.toHaveProperty("oidcDiscovery");
    const disabled = spawnSync(
      process.execPath,
      ["deploy/scripts/server-setup-review.mjs", "--oidc-check"],
      { input: JSON.stringify(review()), encoding: "utf8", timeout: 10_000 },
    );
    expect(disabled.status, disabled.stderr).toBe(0);
    expect(JSON.parse(disabled.stdout) as unknown).toMatchObject({
      oidcDiscovery: { status: "not-required" },
    });
  });

  it.each([
    "[]",
    "{",
    "x".repeat(65537),
    JSON.stringify({ ...review(), privateKey: "fixture-secret-marker" }),
  ])("bounds and rejects invalid CUI input %#", (input) => {
    const result = spawnSync(
      process.execPath,
      ["deploy/scripts/server-setup-review.mjs"],
      { input, encoding: "utf8", timeout: 10_000 },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("fixture-secret-marker");
  });
});
