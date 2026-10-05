import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  importServerSetupProfile,
  parseEnvironmentFile,
  serverSetupProfileEnvironment,
  validateProfileValues,
  validateServerSetupProfile,
} from "../packages/server-setup-core/src/index.mjs";
import * as deployment from "../deploy/scripts/validate-production-profile.mjs";

const base = [
  "PUBLIC_ORIGIN=https://renderer.example.test",
  "RENDERER_PUBLIC_URL=https://renderer.example.test",
];
function environment(mode = "standalone", auth = "password") {
  return [
    ...base,
    `DEPLOYMENT_MODE=${mode}`,
    `AUTH_MODE=${auth}`,
    ...(auth === "oidc"
      ? [
          "OIDC_ISSUER=https://identity.example.test/tenant",
          "OIDC_CLIENT_ID=fixture-renderer",
        ]
      : auth === "cloudflare-access"
        ? [
            "CLOUDFLARE_ACCESS_ISSUER=https://fixture.cloudflareaccess.com",
            `CLOUDFLARE_ADMIN_AUDIENCE=${"a".repeat(64)}`,
            `CLOUDFLARE_REMOTE_MCP_AUDIENCE=${"b".repeat(64)}`,
          ]
        : []),
  ].join("\n");
}
function passwordProfile() {
  return structuredClone(importServerSetupProfile(environment()));
}
function oidcProfile() {
  return structuredClone(
    importServerSetupProfile(environment("standalone", "oidc")),
  );
}

describe("shared server setup production profile core", () => {
  it("uses the exact same pure parser/validator in the deployment adapter", () => {
    expect(deployment.parseEnvironmentFile).toBe(parseEnvironmentFile);
    expect(deployment.validateProfileValues).toBe(validateProfileValues);
  });

  it.each([
    ["standalone", "password"],
    ["standalone", "oidc"],
    ["cloudflare", "password"],
    ["cloudflare", "oidc"],
    ["cloudflare", "cloudflare-access"],
  ])(
    "round-trips %s/%s without changing authentication behavior",
    (mode, auth) => {
      const imported = importServerSetupProfile(environment(mode, auth));
      expect(imported).toMatchObject({
        format: 1,
        deployment: { mode, publicOrigin: "https://renderer.example.test" },
        authentication: { mode: auth },
      });
      const reviewed = validateServerSetupProfile(
        JSON.parse(JSON.stringify(imported)),
      );
      expect(reviewed).toEqual(imported);
      const values = serverSetupProfileEnvironment(reviewed);
      expect(validateProfileValues(values)).toEqual(
        deployment.validateProfileValues(
          parseEnvironmentFile(environment(mode, auth)),
        ),
      );
      expect(
        importServerSetupProfile(
          [...values].map(([k, v]) => `${k}=${v}`).join("\n"),
        ),
      ).toEqual(imported);
      expect(Object.isFrozen(reviewed)).toBe(true);
      expect(Object.isFrozen(reviewed.deployment)).toBe(true);
      expect(Object.isFrozen(reviewed.authentication)).toBe(true);
      expect(reviewed.deployment).not.toHaveProperty("accessScope");
    },
  );

  it("normalizes origin aliases but retains optional admin origin and explicit algorithms", () => {
    const profile = importServerSetupProfile(
      environment("standalone", "oidc").replaceAll(
        "https://renderer.example.test",
        "https://RENDERER.example.test:443/",
      ) +
        "\nADMIN_API_URL=https://renderer.example.test\nOIDC_ALLOWED_ALGORITHMS=ES384, RS512",
    );
    expect(profile.deployment).toEqual({
      mode: "standalone",
      publicOrigin: "https://renderer.example.test",
      rendererPublicUrl: "https://renderer.example.test",
      adminApiUrl: "https://renderer.example.test",
    });
    expect(profile.authentication).toMatchObject({
      allowedAlgorithms: ["ES384", "RS512"],
    });
    expect(
      serverSetupProfileEnvironment(profile).get("OIDC_ALLOWED_ALGORITHMS"),
    ).toBe("ES384,RS512");
  });

  it("does not import secrets or unrelated settings, and produces detached review values", () => {
    const profile = importServerSetupProfile(
      environment("standalone", "oidc") +
        "\nOIDC_CLIENT_SECRET=fixture-secret-marker\nDATABASE_PATH=/private/fixture-marker\nCLOUDFLARE_API_TOKEN=fixture-token-marker",
    );
    const first = serverSetupProfileEnvironment(profile);
    first.set("AUTH_MODE", "password");
    expect(serverSetupProfileEnvironment(profile).get("AUTH_MODE")).toBe(
      "oidc",
    );
    expect(JSON.stringify(profile)).not.toMatch(
      /fixture-(?:secret|token)-marker|private\/fixture-marker/,
    );
    expect([...serverSetupProfileEnvironment(profile).keys()]).not.toContain(
      "OIDC_CLIENT_SECRET",
    );
  });

  it.each([
    [
      "format",
      (p: Record<string, unknown>) => {
        p.format = 2;
      },
    ],
    [
      "unknown root field",
      (p: Record<string, unknown>) => {
        p.ownerPassword = "fixture-secret-marker";
      },
    ],
    [
      "unknown deployment field",
      (p: Record<string, unknown>) => {
        (p.deployment as Record<string, unknown>).listen = "0.0.0.0";
      },
    ],
    [
      "numeric origin",
      (p: Record<string, unknown>) => {
        (p.deployment as Record<string, unknown>).publicOrigin = 123;
      },
    ],
    [
      "HTTP fallback",
      (p: Record<string, unknown>) => {
        (p.deployment as Record<string, unknown>).publicOrigin =
          "http://renderer.example.test";
      },
    ],
    [
      "renderer origin drift",
      (p: Record<string, unknown>) => {
        (p.deployment as Record<string, unknown>).rendererPublicUrl =
          "https://other.example.test";
      },
    ],
    [
      "credential-bearing origin",
      (p: Record<string, unknown>) => {
        (p.deployment as Record<string, unknown>).publicOrigin =
          "https://u:fixture-secret-marker@renderer.example.test";
      },
    ],
    [
      "unsupported dual method",
      (p: Record<string, unknown>) => {
        p.authentication = { mode: "password+oidc" };
      },
    ],
    [
      "secret in model",
      (p: Record<string, unknown>) => {
        p.authentication = {
          mode: "password",
          password: "fixture-secret-marker",
        };
      },
    ],
    [
      "foreign mode fields",
      (p: Record<string, unknown>) => {
        p.authentication = {
          mode: "password",
          issuer: "https://identity.example.test",
        };
      },
    ],
  ])("rejects %s without reflecting input secrets", (_label, mutate) => {
    const profile = passwordProfile() as unknown as Record<string, unknown>;
    mutate(profile);
    try {
      serverSetupProfileEnvironment(profile);
      throw new Error("Expected validation failure");
    } catch (error) {
      expect(String(error)).not.toContain("fixture-secret-marker");
      expect(String(error)).not.toContain("Expected validation failure");
    }
  });

  it("requires Cloudflare deployment for Access and never invents standalone credentials", () => {
    const access = structuredClone(
      importServerSetupProfile(environment("cloudflare", "cloudflare-access")),
    ) as unknown as { deployment: { mode: string } };
    access.deployment.mode = "standalone";
    expect(() => validateServerSetupProfile(access)).toThrow(
      "requires DEPLOYMENT_MODE=cloudflare",
    );
    expect([
      ...serverSetupProfileEnvironment(passwordProfile()).keys(),
    ]).not.toContain("CLOUDFLARE_ACCESS_ISSUER");
  });

  it.each(
    [
      [],
      ["HS256"],
      ["RS256", "RS256"],
      ["RS256,ES256"],
      [" RS256"],
      [1],
      new Array(1),
    ].map((algorithms) => [algorithms]),
  )("rejects malformed/asymmetric algorithm input %#", (algorithms) => {
    const profile = oidcProfile() as unknown as {
      authentication: { allowedAlgorithms: unknown };
    };
    profile.authentication.allowedAlgorithms = algorithms;
    expect(() => validateServerSetupProfile(profile)).toThrow();
  });

  it("rejects custom prototypes, accessors and array method injection without invoking them", () => {
    const getter = vi.fn(() => "password");
    const profile = passwordProfile();
    Object.defineProperty(profile.authentication, "mode", { get: getter });
    expect(() => validateServerSetupProfile(profile)).toThrow(/accessors/);
    expect(getter).not.toHaveBeenCalled();
    const inherited: unknown = Object.create({ ...passwordProfile() });
    expect(() => validateServerSetupProfile(inherited)).toThrow(/plain object/);
    const oidc = oidcProfile() as unknown as {
      authentication: { allowedAlgorithms: unknown };
    };
    const array = ["RS256"];
    Object.defineProperty(array, "join", { value: getter });
    oidc.authentication.allowedAlgorithms = array;
    expect(() => validateServerSetupProfile(oidc)).toThrow(
      /unsupported fields/,
    );
    expect(getter).not.toHaveBeenCalled();
  });

  it("keeps strict legacy duplicate/control checks even for ignored secrets", () => {
    expect(() =>
      importServerSetupProfile(
        environment() + "\nOTHER_SECRET=x\nOTHER_SECRET=y",
      ),
    ).toThrow(/duplicate/);
    expect(() =>
      importServerSetupProfile(environment() + "\nOTHER_SECRET=x\u0007y"),
    ).toThrow(/control characters/);
  });

  it("works from copied verified source without builds, pnpm dependencies or root access", async () => {
    const root = await mkdtemp(join(tmpdir(), "server-setup-core-"));
    try {
      await mkdir(join(root, "deploy/scripts"), { recursive: true });
      await cp(
        "packages/server-setup-core",
        join(root, "packages/server-setup-core"),
        { recursive: true },
      );
      await cp(
        "deploy/scripts/server-ingress.mjs",
        join(root, "deploy/scripts/server-ingress.mjs"),
      );
      await cp(
        "deploy/scripts/validate-production-profile.mjs",
        join(root, "deploy/scripts/validate-production-profile.mjs"),
      );
      const result = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          "const core = await import(process.env.CORE_URL); const adapter = await import(process.env.ADAPTER_URL); if (core.validateProfileValues !== adapter.validateProfileValues) process.exit(1); console.log(JSON.stringify(core.importServerSetupProfile(process.env.PROFILE)));",
        ],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            CORE_URL: pathToFileURL(
              join(root, "packages/server-setup-core/src/index.mjs"),
            ).href,
            ADAPTER_URL: pathToFileURL(
              join(root, "deploy/scripts/validate-production-profile.mjs"),
            ).href,
            PROFILE: environment(),
          },
          timeout: 10_000,
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual(passwordProfile());
      const hostAdapter = await readFile(
        "deploy/scripts/validate-production-profile.mjs",
        "utf8",
      );
      expect(hostAdapter).toContain("process.geteuid?.() !== 0");
      expect(hostAdapter).toContain("assertSecureFile(environmentPath");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
