import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { authenticationFailureDiagnostic } from "../deploy/scripts/configure-authentication.mjs";

describe("bounded private authentication operation diagnostics", () => {
  it.each([
    "arguments",
    "mutation-lock",
    "review-path",
    "review-read",
    "recovery-order",
    "auth-secrets",
    "owner-readiness",
    "service-active",
    "readiness",
    "apply",
  ])(
    "reports only the trusted %s phase with the original failure prefix",
    (phase) => {
      const message = authenticationFailureDiagnostic(phase);
      expect(message).toMatch(
        /^Authentication operation failed; configuration was not certified\./,
      );
      expect(message).toContain(`[phase=${phase}]`);
      expect(message.length).toBeLessThan(256);
      expect(message.split("\n")).toHaveLength(2);
    },
  );
  it.each([
    null,
    undefined,
    1,
    {},
    new Error("private-marker"),
    "private-marker",
    "readiness\nprivate-marker",
    "x".repeat(100000),
  ])(
    "does not serialize an invalid or credential-bearing phase (%#)",
    (phase) => {
      const message = authenticationFailureDiagnostic(phase);
      expect(message).toContain("[phase=unknown]");
      expect(message).not.toContain("private-marker");
      expect(message.length).toBeLessThan(256);
    },
  );
  it.skipIf(process.geteuid?.() === 0)(
    "preserves the non-root refusal with no secret argument echo",
    () => {
      const command = spawnSync(
        process.execPath,
        [
          "deploy/scripts/configure-authentication.mjs",
          "--setup-apply",
          "/private-marker",
        ],
        { encoding: "utf8", timeout: 10000 },
      );
      expect(command.status).toBe(1);
      expect(command.stderr).toContain("[phase=arguments]");
      expect(command.stderr).not.toContain("private-marker");
      expect(command.stdout).toBe("");
    },
  );
});
