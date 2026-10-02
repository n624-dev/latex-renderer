import { spawnSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  importServerSetupAuthenticationReview as importReview,
  migrateServerSetupAuthenticationReview as migrate,
  validateServerSetupAuthenticationReview as validate,
  serverSetupAuthenticationReviewEnvironment as environmentMap,
  serverSetupInitialOwnerPlan as ownerPlan,
  importServerSetupProfile,
  validateServerSetupProfile,
  validateProfileValues,
  legacyBrowserAuthenticationMode,
} from "../packages/server-setup-core/src/index.mjs";
import { createBrowserAuthenticationFromEnvironment } from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import * as deployment from "../deploy/scripts/validate-production-profile.mjs";

function environment(
  deploymentMode = "standalone",
  passwordEnabled = true,
  oidcEnabled = true,
) {
  return [
    "PUBLIC_ORIGIN=https://renderer.example.test",
    "RENDERER_PUBLIC_URL=https://renderer.example.test",
    `DEPLOYMENT_MODE=${deploymentMode}`,
    "AUTH_BACKEND=native",
    `AUTH_PASSWORD_ENABLED=${passwordEnabled}`,
    `AUTH_OIDC_ENABLED=${oidcEnabled}`,
    ...(oidcEnabled
      ? [
          "OIDC_ISSUER=https://identity.example.test/tenant",
          "OIDC_CLIENT_ID=fixture-client",
          "OIDC_DISPLAY_NAME=School Account",
        ]
      : []),
  ].join("\n");
}
function accessEnvironment() {
  return [
    "PUBLIC_ORIGIN=https://renderer.example.test",
    "RENDERER_PUBLIC_URL=https://renderer.example.test",
    "DEPLOYMENT_MODE=cloudflare",
    "AUTH_BACKEND=cloudflare-access",
    "CLOUDFLARE_ACCESS_ISSUER=https://fixture.cloudflareaccess.com",
    `CLOUDFLARE_ADMIN_AUDIENCE=${"a".repeat(64)}`,
    `CLOUDFLARE_REMOTE_MCP_AUDIENCE=${"b".repeat(64)}`,
  ].join("\n");
}
function serialize(values: ReadonlyMap<string, string>) {
  return [...values].map(([key, value]) => `${key}=${value}`).join("\n");
}
function mutableReview(): Record<string, unknown> {
  return structuredClone(importReview(environment())) as unknown as Record<
    string,
    unknown
  >;
}

describe("shared format-2 authentication review", () => {
  it.each([
    ["standalone", true, false],
    ["standalone", false, true],
    ["standalone", true, true],
    ["cloudflare", true, false],
    ["cloudflare", false, true],
    ["cloudflare", true, true],
  ] as const)(
    "reviews %s / Password %s / OIDC %s",
    (mode, passwordEnabled, oidcEnabled) => {
      const review = importReview(
        environment(mode, passwordEnabled, oidcEnabled),
      );
      expect(review).toMatchObject({
        format: 2,
        deployment: { mode },
        authentication: { backend: "native", passwordEnabled, oidcEnabled },
      });
      expect(validate(JSON.parse(JSON.stringify(review)))).toEqual(review);
      const values = environmentMap(review);
      expect(values.has("AUTH_MODE")).toBe(false);
      expect(values.get("AUTH_PASSWORD_ENABLED")).toBe(String(passwordEnabled));
      expect(values.get("AUTH_OIDC_ENABLED")).toBe(String(oidcEnabled));
      expect(importReview(serialize(values))).toEqual(review);
      expect(Object.isFrozen(review)).toBe(true);
      expect(Object.isFrozen(review.deployment)).toBe(true);
      expect(Object.isFrozen(review.authentication)).toBe(true);
      if (
        review.authentication.backend === "native" &&
        review.authentication.oidcEnabled
      ) {
        expect(Object.isFrozen(review.authentication.oidc)).toBe(true);
        expect(
          Object.isFrozen(review.authentication.oidc.allowedAlgorithms),
        ).toBe(true);
        expect(review.authentication.oidc).toEqual({
          issuer: "https://identity.example.test/tenant",
          clientId: "fixture-client",
          allowedAlgorithms: ["RS256", "ES256"],
          displayName: "School Account",
        });
      }
      expect(
        [...values.keys()].some((key) => key.startsWith("CLOUDFLARE_")),
      ).toBe(false);
    },
  );

  it("retains the complete Access review without native or OIDC dependencies", () => {
    const review = importReview(accessEnvironment());
    expect(review.authentication).toEqual({
      backend: "cloudflare-access",
      issuer: "https://fixture.cloudflareaccess.com",
      adminAudience: "a".repeat(64),
      remoteMcpAudience: "b".repeat(64),
    });
    expect(importReview(serialize(environmentMap(review)))).toEqual(review);
    expect(ownerPlan(review)).toEqual({
      bootstrapMethod: "cloudflare-access",
      followUpOidcRegistration: false,
    });
    expect(
      [...environmentMap(review).keys()].some(
        (key) => key.startsWith("OIDC_") || key.startsWith("AUTH_PASSWORD"),
      ),
    ).toBe(false);
    expect(() =>
      importReview(
        accessEnvironment().replace(
          "DEPLOYMENT_MODE=cloudflare",
          "DEPLOYMENT_MODE=standalone",
        ),
      ),
    ).toThrow("requires DEPLOYMENT_MODE=cloudflare");
  });

  it.each(["password", "oidc", "cloudflare-access"] as const)(
    "explicitly migrates legacy %s without adding another login method",
    (mode) => {
      const contents =
        mode === "cloudflare-access"
          ? accessEnvironment().replace(
              "AUTH_BACKEND=cloudflare-access",
              "AUTH_MODE=cloudflare-access",
            )
          : environment("standalone", mode === "password", mode === "oidc")
              .replace(
                /AUTH_BACKEND=native\nAUTH_PASSWORD_ENABLED=(?:true|false)\nAUTH_OIDC_ENABLED=(?:true|false)/,
                `AUTH_MODE=${mode}`,
              )
              .replace("\nOIDC_DISPLAY_NAME=School Account", "");
      const legacy = importServerSetupProfile(contents);
      expect(legacy.format).toBe(1);
      expect(validateServerSetupProfile(legacy)).toEqual(legacy);
      const review = importReview(contents);
      expect(migrate(legacy)).toEqual(review);
      expect(ownerPlan(review)).toEqual({
        bootstrapMethod: mode,
        followUpOidcRegistration: false,
      });
      if (review.authentication.backend === "native") {
        expect(review.authentication.passwordEnabled).toBe(mode === "password");
        expect(review.authentication.oidcEnabled).toBe(mode === "oidc");
      }
      expect(() => validate(legacy)).toThrow("format must be 2");
      expect(() => validateServerSetupProfile(review)).toThrow(
        "format must be 1",
      );
    },
  );

  it("plans password-first owner creation and explicit follow-up OIDC registration", () => {
    expect(ownerPlan(importReview(environment()))).toEqual({
      bootstrapMethod: "password",
      followUpOidcRegistration: true,
    });
    expect(Object.isFrozen(ownerPlan(importReview(environment())))).toBe(true);
    expect(
      ownerPlan(importReview(environment("standalone", true, false))),
    ).toEqual({ bootstrapMethod: "password", followUpOidcRegistration: false });
    expect(
      ownerPlan(importReview(environment("standalone", false, true))),
    ).toEqual({ bootstrapMethod: "oidc", followUpOidcRegistration: false });
  });

  it("validates every enabled method instead of just the owner's password path", () => {
    expect(() =>
      importReview(
        environment().replace("\nOIDC_CLIENT_ID=fixture-client", ""),
      ),
    ).toThrow("OIDC_CLIENT_ID");
    expect(() =>
      importReview(environment() + "\nOIDC_ALLOWED_ALGORITHMS=HS256"),
    ).toThrow("asymmetric");
    expect(() => importReview(environment("standalone", false, false))).toThrow(
      "at least one",
    );
  });

  it("keeps runtime and privileged deployment gated before secret or database operations", () => {
    const values = environmentMap(importReview(environment()));
    expect(deployment.validateProfileValues).toBe(validateProfileValues);
    expect(() => validateProfileValues(values)).toThrow("not deployable yet");
    expect(() => deployment.validateProfileValues(values)).toThrow(
      "not deployable yet",
    );
    expect(() => legacyBrowserAuthenticationMode(values)).toThrow(
      "not deployable yet",
    );
    expect(() => importServerSetupProfile(serialize(values))).toThrow(
      "not deployable yet",
    );
    const database = new RendererDatabase(":memory:");
    try {
      expect(() =>
        createBrowserAuthenticationFromEnvironment(
          database,
          "CLOUDFLARE_ADMIN_AUDIENCE",
          Object.fromEntries(values),
        ),
      ).toThrow("not deployable yet");
      expect(
        database.raw
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE type='table'",
          )
          .get(),
      ).toMatchObject({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("normalizes origins and algorithm spelling through existing validators", () => {
    const review = importReview(
      environment().replaceAll(
        "https://renderer.example.test",
        "https://RENDERER.example.test:443/",
      ) +
        "\nADMIN_API_URL=https://renderer.example.test\nOIDC_ALLOWED_ALGORITHMS=ES384, RS512",
    );
    expect(review.deployment).toEqual({
      mode: "standalone",
      publicOrigin: "https://renderer.example.test",
      rendererPublicUrl: "https://renderer.example.test",
      adminApiUrl: "https://renderer.example.test",
    });
    expect(environmentMap(review).get("OIDC_ALLOWED_ALGORITHMS")).toBe(
      "ES384,RS512",
    );
  });

  it("excludes secrets, unrelated settings and disabled provider remnants", () => {
    const review = importReview(
      environment("standalone", true, false) +
        "\nOIDC_CLIENT_SECRET=fixture-secret-marker\nOIDC_ISSUER=https://old.example.test\nOIDC_CLIENT_ID=old\nAUTH_PASSWORD_PEPPER_FILE=/private/fixture-marker\nCLOUDFLARE_API_TOKEN=fixture-token-marker",
    );
    expect(JSON.stringify(review)).not.toMatch(
      /fixture-(?:secret|token|marker)|old\.example/,
    );
    const values = environmentMap(review);
    expect(
      [...values.keys()].some(
        (key) =>
          key.startsWith("OIDC_") ||
          key.includes("SECRET") ||
          key.includes("PEPPER"),
      ),
    ).toBe(false);
    values.set("AUTH_PASSWORD_ENABLED", "false");
    expect(environmentMap(review).get("AUTH_PASSWORD_ENABLED")).toBe("true");
  });

  it.each([
    [
      "format",
      (p: Record<string, unknown>) => {
        p.format = 3;
      },
    ],
    [
      "root secret",
      (p: Record<string, unknown>) => {
        p.password = "fixture-secret-marker";
      },
    ],
    [
      "deployment secret",
      (p: Record<string, unknown>) => {
        p.deployment = {
          ...(p.deployment as object),
          secret: "fixture-secret-marker",
        };
      },
    ],
    [
      "credential URL",
      (p: Record<string, unknown>) => {
        (p.deployment as Record<string, unknown>).publicOrigin =
          "https://u:fixture-secret-marker@renderer.example.test";
      },
    ],
    [
      "origin drift",
      (p: Record<string, unknown>) => {
        (p.deployment as Record<string, unknown>).rendererPublicUrl =
          "https://other.example.test";
      },
    ],
    [
      "missing method",
      (p: Record<string, unknown>) => {
        delete (p.authentication as Record<string, unknown>).passwordEnabled;
      },
    ],
    [
      "ambiguous flag",
      (p: Record<string, unknown>) => {
        (p.authentication as Record<string, unknown>).passwordEnabled = "true";
      },
    ],
    [
      "missing OIDC metadata",
      (p: Record<string, unknown>) => {
        delete (p.authentication as Record<string, unknown>).oidc;
      },
    ],
    [
      "disabled OIDC metadata",
      (p: Record<string, unknown>) => {
        (p.authentication as Record<string, unknown>).oidcEnabled = false;
      },
    ],
    [
      "mixed backend fields",
      (p: Record<string, unknown>) => {
        (p.authentication as Record<string, unknown>).adminAudience =
          "a".repeat(64);
      },
    ],
    [
      "OIDC secret",
      (p: Record<string, unknown>) => {
        (
          (p.authentication as Record<string, unknown>).oidc as Record<
            string,
            unknown
          >
        ).clientSecret = "fixture-secret-marker";
      },
    ],
    [
      "empty label",
      (p: Record<string, unknown>) => {
        (
          (p.authentication as Record<string, unknown>).oidc as Record<
            string,
            unknown
          >
        ).displayName = "";
      },
    ],
    [
      "control label",
      (p: Record<string, unknown>) => {
        (
          (p.authentication as Record<string, unknown>).oidc as Record<
            string,
            unknown
          >
        ).displayName = "bad\nlabel";
      },
    ],
    [
      "symmetric algorithm",
      (p: Record<string, unknown>) => {
        (
          (p.authentication as Record<string, unknown>).oidc as Record<
            string,
            unknown
          >
        ).allowedAlgorithms = ["HS256"];
      },
    ],
  ] as const)("rejects %s without secret reflection", (_label, mutate) => {
    const input = mutableReview();
    mutate(input);
    for (const operation of [validate, environmentMap, ownerPlan]) {
      expect(() => operation(input)).toThrow();
      try {
        operation(input);
      } catch (error) {
        expect(String(error)).not.toContain("fixture-secret-marker");
      }
    }
  });

  it("rejects Access/native method mixing", () => {
    const input = structuredClone(
      importReview(accessEnvironment()),
    ) as unknown as Record<string, unknown>;
    (input.authentication as Record<string, unknown>).passwordEnabled = true;
    expect(() => validate(input)).toThrow("unsupported fields");
    expect(() =>
      importReview(accessEnvironment() + "\nAUTH_OIDC_ENABLED=true"),
    ).toThrow("must not configure native");
    expect(() => importReview(environment() + "\nAUTH_MODE=password")).toThrow(
      "must not be configured together",
    );
  });

  it("does not invoke accessors or accept prototype/array extensions", () => {
    const getter = vi.fn(() => "fixture-secret-marker");
    const input = mutableReview();
    Object.defineProperty(input.authentication, "oidc", { get: getter });
    expect(() => validate(input)).toThrow("accessors");
    expect(getter).not.toHaveBeenCalled();
    expect(() => validate(Object.create(input))).toThrow("plain object");
    const other = mutableReview(),
      oidc = (other.authentication as Record<string, unknown>).oidc as Record<
        string,
        unknown
      >;
    const algorithms: unknown[] = [];
    Object.defineProperty(algorithms, 0, { get: getter });
    oidc.allowedAlgorithms = algorithms;
    expect(() => validate(other)).toThrow("individual strings");
    expect(getter).not.toHaveBeenCalled();
  });

  it("does not execute fetch or mutate a supplied model during review", () => {
    const fetch = vi.fn(() => {
      throw new Error("unexpected provider access");
    });
    vi.stubGlobal("fetch", fetch);
    try {
      const input = mutableReview(),
        before = structuredClone(input);
      validate(input);
      environmentMap(input);
      ownerPlan(input);
      expect(input).toEqual(before);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("works from copied release source without workspace dependencies", async () => {
    const root = await mkdtemp(join(tmpdir(), "server-auth-review-test-"));
    try {
      const source = join(root, "core");
      await cp(
        new URL("../packages/server-setup-core/src/", import.meta.url),
        source,
        { recursive: true },
      );
      const script = `import {importServerSetupAuthenticationReview,serverSetupInitialOwnerPlan} from ${JSON.stringify(pathToFileURL(join(source, "index.mjs")).href)};const review=importServerSetupAuthenticationReview(process.argv[1]);process.stdout.write(JSON.stringify(serverSetupInitialOwnerPlan(review)));`;
      const result = spawnSync(
        process.execPath,
        ["--input-type=module", "--eval", script, environment()],
        { cwd: root, encoding: "utf8", timeout: 10_000 },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        bootstrapMethod: "password",
        followUpOidcRegistration: true,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
