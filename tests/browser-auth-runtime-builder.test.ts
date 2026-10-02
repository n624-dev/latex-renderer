import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";
import { createBrowserAuthenticationFromEnvironment } from "@latex-renderer/auth";
import { buildBrowserAuthentication } from "../packages/auth/src/runtime-builder.js";

const databases: RendererDatabase[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true });
  vi.restoreAllMocks();
});
function fixture() {
  const database = new RendererDatabase(":memory:");
  databases.push(database);
  database.migrate();
  const directory = mkdtempSync(join(tmpdir(), "auth-runtime-builder-"));
  directories.push(directory);
  writeFileSync(join(directory, "auth-password-pepper"), Buffer.alloc(32, 7), {
    mode: 0o600,
  });
  writeFileSync(
    join(directory, "oidc-client-secret"),
    "synthetic-oidc-client-secret",
    { mode: 0o600 },
  );
  const environment: NodeJS.ProcessEnv = {
    DEPLOYMENT_MODE: "standalone",
    PUBLIC_ORIGIN: "https://renderer.example.test",
    CREDENTIALS_DIRECTORY: directory,
    OIDC_ISSUER: "https://id.example.test/tenant",
    OIDC_CLIENT_ID: "fixture",
  };
  return { database, directory, environment };
}
const dual = {
  backend: "native",
  passwordEnabled: true,
  oidcEnabled: true,
  oidcDisplayName: "School Account",
} as const;
describe("internal selection-aware runtime construction", () => {
  it.each(["CLOUDFLARE_ADMIN_AUDIENCE", "CLOUDFLARE_REMOTE_MCP_AUDIENCE"])(
    "constructs both native methods for %s using real credential files",
    (audience) => {
      const f = fixture();
      const network = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("Network forbidden"));
      const result = buildBrowserAuthentication(
        f.database,
        dual,
        audience,
        f.environment,
      );
      expect(result.browserAuth.configuration().methods).toEqual([
        { id: "password" },
        { id: "oidc", displayName: "School Account" },
      ]);
      expect(JSON.stringify(result.browserAuth.configuration())).not.toMatch(
        /secret|pepper|clientId/,
      );
      expect(network).not.toHaveBeenCalled();
    },
  );
  it.each(["password", "oidc"] as const)(
    "does not read the disabled %s credential",
    (disabled) => {
      const f = fixture();
      f.environment[
        disabled === "password"
          ? "AUTH_PASSWORD_PEPPER_FILE"
          : "OIDC_CLIENT_SECRET_FILE"
      ] = "/must-not-read/disabled-credential";
      const result = buildBrowserAuthentication(
        f.database,
        {
          backend: "native",
          passwordEnabled: disabled !== "password",
          oidcEnabled: disabled !== "oidc",
        },
        "unused",
        f.environment,
      );
      expect(result.browserAuth.mode).toBe(
        disabled === "password" ? "oidc" : "password",
      );
    },
  );
  it.each([
    "missing-pepper",
    "short-pepper",
    "missing-oidc",
    "short-oidc",
    "algorithm",
  ])("dual construction fails without partial retirement: %s", (failure) => {
    const f = fixture();
    const retire = vi.spyOn(
      f.database.browserAuth,
      "retireSessionsOutsidePolicy",
    );
    if (failure === "missing-pepper")
      f.environment.AUTH_PASSWORD_PEPPER_FILE = "/must-not-exist/pepper";
    else if (failure === "short-pepper")
      writeFileSync(
        join(f.directory, "auth-password-pepper"),
        Buffer.alloc(16),
      );
    else if (failure === "missing-oidc")
      f.environment.OIDC_CLIENT_SECRET_FILE = "/must-not-exist/oidc";
    else if (failure === "short-oidc")
      writeFileSync(
        join(f.directory, "oidc-client-secret"),
        "        short        ",
      );
    else f.environment.OIDC_ALLOWED_ALGORITHMS = "HS256";
    expect(() =>
      buildBrowserAuthentication(f.database, dual, "unused", f.environment),
    ).toThrow();
    expect(retire).not.toHaveBeenCalled();
  });
  it("does not expose the internal builder or enable installed new keys through the public entry point", async () => {
    const f = fixture();
    const publicApi = await import("@latex-renderer/auth");
    expect(Object.hasOwn(publicApi, "buildBrowserAuthentication")).toBe(false);
    expect(() =>
      createBrowserAuthenticationFromEnvironment(f.database, undefined, {
        ...f.environment,
        AUTH_BACKEND: "native",
        AUTH_PASSWORD_ENABLED: "true",
        AUTH_OIDC_ENABLED: "true",
      }),
    ).toThrow(/not deployable yet/);
  });
});
