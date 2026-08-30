import { describe, expect, it } from "vitest";
import {
  parseEnvironmentFile,
  validateProfileValues,
} from "../deploy/scripts/validate-production-profile.mjs";

const base = [
  "PUBLIC_ORIGIN=https://latex.example.test",
  "RENDERER_PUBLIC_URL=https://latex.example.test",
  "ADMIN_API_URL=https://latex.example.test",
];

describe("production profile validation", () => {
  it("accepts strict standalone password and OIDC profiles", () => {
    expect(
      validateProfileValues(
        parseEnvironmentFile(
          [...base, "DEPLOYMENT_MODE=standalone", "AUTH_MODE=password"].join(
            "\n",
          ),
        ),
      ),
    ).toMatchObject({ deploymentMode: "standalone", authMode: "password" });
    expect(
      validateProfileValues(
        parseEnvironmentFile(
          [
            ...base,
            "DEPLOYMENT_MODE=standalone",
            "AUTH_MODE=oidc",
            "OIDC_ISSUER=https://identity.example.test/tenant",
            "OIDC_CLIENT_ID=latex-renderer",
            "OIDC_ALLOWED_ALGORITHMS=RS256,ES256",
          ].join("\n"),
        ),
      ),
    ).toMatchObject({ deploymentMode: "standalone", authMode: "oidc" });
  });

  it("accepts Cloudflare hosting with any supported browser authentication mode", () => {
    for (const authMode of ["password", "oidc", "cloudflare-access"]) {
      const modeSettings =
        authMode === "oidc"
          ? [
              "OIDC_ISSUER=https://identity.example.test/",
              "OIDC_CLIENT_ID=latex-renderer",
            ]
          : authMode === "cloudflare-access"
            ? [
                "CLOUDFLARE_ACCESS_ISSUER=https://team.cloudflareaccess.com",
                `CLOUDFLARE_ADMIN_AUDIENCE=${"a".repeat(64)}`,
                `CLOUDFLARE_REMOTE_MCP_AUDIENCE=${"b".repeat(64)}`,
              ]
            : [];
      expect(
        validateProfileValues(
          parseEnvironmentFile(
            [
              ...base,
              "DEPLOYMENT_MODE=cloudflare",
              `AUTH_MODE=${authMode}`,
              ...modeSettings,
            ].join("\n"),
          ),
        ),
      ).toMatchObject({ deploymentMode: "cloudflare", authMode });
    }
  });

  it("rejects duplicate keys, placeholders, origin drift, and insecure algorithms", () => {
    expect(() =>
      parseEnvironmentFile("AUTH_MODE=password\nAUTH_MODE=oidc"),
    ).toThrow(/duplicate AUTH_MODE/);
    expect(() =>
      validateProfileValues(
        parseEnvironmentFile(
          [
            ...base,
            "DEPLOYMENT_MODE=standalone",
            "AUTH_MODE=oidc",
            "OIDC_ISSUER=https://identity.example.com/",
            "OIDC_CLIENT_ID=latex-renderer",
          ].join("\n"),
        ),
      ),
    ).toThrow(/placeholder/);
    expect(() =>
      validateProfileValues(
        parseEnvironmentFile(
          [
            ...base.filter((line) => !line.startsWith("RENDERER_PUBLIC_URL=")),
            "RENDERER_PUBLIC_URL=https://other.example.test",
            "DEPLOYMENT_MODE=standalone",
            "AUTH_MODE=password",
          ].join("\n"),
        ),
      ),
    ).toThrow(/exactly equal/);
    expect(() =>
      validateProfileValues(
        parseEnvironmentFile(
          [
            ...base,
            "DEPLOYMENT_MODE=standalone",
            "AUTH_MODE=oidc",
            "OIDC_ISSUER=https://identity.example.test/",
            "OIDC_CLIENT_ID=latex-renderer",
            "OIDC_ALLOWED_ALGORITHMS=HS256",
          ].join("\n"),
        ),
      ),
    ).toThrow(/asymmetric allowlist/);
  });
});
