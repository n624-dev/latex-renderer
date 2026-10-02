import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  browserAuthenticationRequirements,
  parseEnvironmentFile,
  productionAuthenticationPlan,
} from "../packages/server-setup-core/src/index.mjs";

const fake = vi.hoisted(() => ({
  files: new Map<
    string,
    {
      size: number;
      mode: number;
      uid: number;
      gid: number;
      regular: boolean;
      symlink: boolean;
      text: string;
    }
  >(),
}));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    lstatSync: vi.fn((path: string) => {
      const file = fake.files.get(path);
      if (file === undefined) throw new Error("Synthetic secret unavailable");
      return {
        ...file,
        isFile: () => file.regular,
        isSymbolicLink: () => file.symlink,
      };
    }),
    readFileSync: vi.fn(
      (path: Parameters<typeof fs.readFileSync>[0], options?: unknown) => {
        if (
          typeof path === "string" &&
          path.startsWith("/etc/latex-renderer/")
        ) {
          const file = fake.files.get(path);
          if (file === undefined)
            throw new Error("Synthetic secret unavailable");
          return file.text;
        }
        return fs.readFileSync(
          path,
          options as Parameters<typeof fs.readFileSync>[1],
        );
      },
    ),
  };
});
import {
  productionAuthPlanField,
  verifyProductionAuthSecrets,
} from "../deploy/scripts/validate-production-profile.mjs";

function values(mode: "password" | "oidc" | "cloudflare-access" = "password") {
  return parseEnvironmentFile(
    [
      "PUBLIC_ORIGIN=https://renderer.example.test/",
      "RENDERER_PUBLIC_URL=https://renderer.example.test",
      `DEPLOYMENT_MODE=${mode === "cloudflare-access" ? "cloudflare" : "standalone"}`,
      `AUTH_MODE=${mode}`,
      "OIDC_ISSUER=https://id.example.test/tenant",
      "OIDC_CLIENT_ID=fixture",
      "CLOUDFLARE_ACCESS_ISSUER=https://fixture.cloudflareaccess.com",
      `CLOUDFLARE_ADMIN_AUDIENCE=${"a".repeat(64)}`,
      `CLOUDFLARE_REMOTE_MCP_AUDIENCE=${"b".repeat(64)}`,
      "OIDC_CLIENT_SECRET_FILE=/excluded/private/file",
      "API_KEY_PEPPER_FILE=/excluded/pepper",
    ].join("\n"),
  );
}
const gid = 65432;
const oidcPath = "/etc/latex-renderer/secrets/oidc-client-secret";
const pepperPath = "/etc/latex-renderer/secrets/auth-password-pepper";
function secrets() {
  fake.files.clear();
  for (const path of [oidcPath, pepperPath])
    fake.files.set(path, {
      size: 32,
      mode: 0o440,
      uid: 0,
      gid,
      regular: true,
      symlink: false,
      text: "synthetic-secret-for-unit-testing",
    });
}

describe("shared production authentication consumer plan", () => {
  it.each(["password", "oidc", "cloudflare-access"] as const)(
    "preserves legacy %s behavior without secret paths",
    (mode) => {
      const plan = productionAuthenticationPlan(values(mode));
      expect(plan.authMode).toBe(mode);
      expect(plan.bootstrapMethod).toBe(mode);
      expect(plan.passwordEnabled).toBe(mode === "password");
      expect(plan.oidcEnabled).toBe(mode === "oidc");
      expect(plan.followUpOidcRegistration).toBe(false);
      expect(plan.publicOrigin).toBe("https://renderer.example.test");
      expect(Object.isFrozen(plan)).toBe(true);
      expect(JSON.stringify(plan)).not.toMatch(
        /excluded|SECRET|PEPPER|clientId/,
      );
      const json = JSON.stringify(plan);
      for (const [field, value] of Object.entries(plan))
        expect(productionAuthPlanField(json, field)).toBe(String(value));
    },
  );
  it("derives both credentials and approved Password-first owner policy from one validated selection", () => {
    const requirements = browserAuthenticationRequirements({
      backend: "native",
      passwordEnabled: true,
      oidcEnabled: true,
    });
    expect(requirements).toEqual({
      passwordEnabled: true,
      oidcEnabled: true,
      bootstrapMethod: "password",
      followUpOidcRegistration: true,
    });
    expect(Object.isFrozen(requirements)).toBe(true);
    expect(() =>
      browserAuthenticationRequirements({
        backend: "native",
        passwordEnabled: false,
        oidcEnabled: false,
      }),
    ).toThrow();
  });
  it("produces a dual-method plan with both credential requirements", () => {
    const input = values();
    input.delete("AUTH_MODE");
    input.set("AUTH_BACKEND", "native");
    input.set("AUTH_PASSWORD_ENABLED", "true");
    input.set("AUTH_OIDC_ENABLED", "true");
    expect(productionAuthenticationPlan(input)).toMatchObject({
      authMode: "native",
      passwordEnabled: true,
      oidcEnabled: true,
      bootstrapMethod: "password",
      followUpOidcRegistration: true,
    });
  });
  it.each([
    "OIDC_CLIENT_SECRET",
    "__proto__",
    "constructor",
    "API_KEY_PEPPER_FILE",
  ])("rejects arbitrary plan field %s", (field) => {
    expect(() =>
      productionAuthPlanField(
        JSON.stringify(productionAuthenticationPlan(values())),
        field,
      ),
    ).toThrow(/Unsupported/);
  });
  it.each(["secret-marker", "null", "[]", "{}"])(
    "rejects malformed JSON/shape without reflecting input: %s",
    (text) => {
      expect(() => productionAuthPlanField(text, "publicOrigin")).toThrow(
        /Invalid production/,
      );
      try {
        productionAuthPlanField(text, "publicOrigin");
      } catch (error) {
        expect(String(error)).not.toContain("secret-marker");
      }
    },
  );
  it.each([
    "extra",
    "boolean",
    "control",
    "mode",
    "inconsistent",
    "origin",
    "issuer",
  ])("rejects altered plan %s", (kind) => {
    const plan: Record<string, unknown> = {
      ...productionAuthenticationPlan(values()),
    };
    if (kind === "extra") plan.secret = "private";
    else if (kind === "boolean") plan.passwordEnabled = "true";
    else if (kind === "control")
      plan.publicOrigin = "https://renderer.example.test\nINJECT=true";
    else if (kind === "mode") plan.authMode = "unsupported";
    else if (kind === "inconsistent") plan.bootstrapMethod = "oidc";
    else if (kind === "origin")
      plan.publicOrigin = "http://renderer.example.test";
    else plan.externalIssuer = "https://id.example.test";
    expect(() =>
      productionAuthPlanField(JSON.stringify(plan), "bootstrapMethod"),
    ).toThrow(/Invalid production/);
  });
});

describe("privileged secret preflight (synthetic stat/read only)", () => {
  it.each(["password", "oidc", "cloudflare-access"] as const)(
    "requires only enabled %s credentials",
    (mode) => {
      secrets();
      if (mode !== "password") fake.files.delete(pepperPath);
      if (mode !== "oidc") fake.files.delete(oidcPath);
      expect(() =>
        verifyProductionAuthSecrets(
          productionAuthenticationPlan(values(mode)),
          gid,
        ),
      ).not.toThrow();
    },
  );
  it.each([pepperPath, oidcPath])(
    "a dual plan requires %s as well as the other credential",
    (missing) => {
      secrets();
      fake.files.delete(missing);
      const dual = {
        ...productionAuthenticationPlan(values()),
        ...browserAuthenticationRequirements({
          backend: "native",
          passwordEnabled: true,
          oidcEnabled: true,
        }),
        authMode: "native" as const,
      };
      expect(() => verifyProductionAuthSecrets(dual, gid)).toThrow(
        /unavailable/,
      );
      secrets();
      expect(() => verifyProductionAuthSecrets(dual, gid)).not.toThrow();
    },
  );
  it.each(["symlink", "owner", "group", "mode", "small", "large", "trimmed"])(
    "rejects unsafe credential %s",
    (kind) => {
      secrets();
      const file = fake.files.get(oidcPath);
      if (file === undefined) throw new Error("Missing fixture");
      if (kind === "symlink") file.symlink = true;
      else if (kind === "owner") file.uid = 1000;
      else if (kind === "group") file.gid += 1;
      else if (kind === "mode") file.mode = 0o644;
      else if (kind === "small") file.size = 15;
      else if (kind === "large") file.size = 16385;
      else file.text = "     short    ";
      expect(() =>
        verifyProductionAuthSecrets(
          productionAuthenticationPlan(values("oidc")),
          gid,
        ),
      ).toThrow();
    },
  );
});

describe("host shell consumers (no privileged execution)", () => {
  it("host setting replacement preserves literal sed metacharacters", () => {
    const source = readFileSync(
      new URL("../deploy/scripts/configure-host-access.sh", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("upsert_setting() {");
    const end = source.indexOf("profile_validator=", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const directory = mkdtempSync(join(tmpdir(), "host-auth-setting-fixture-"));
    try {
      const path = join(directory, "synthetic.env");
      writeFileSync(path, "ADMIN_API_URL=previous\nKEEP=unchanged\n", {
        mode: 0o600,
      });
      const value = "https://synthetic.example.test/a&b|c\\d";
      const result = spawnSync(
        "sh",
        [
          "-c",
          `set -eu\nenv_file="$1"\n${source.slice(start, end)}\nupsert_setting ADMIN_API_URL "$2"`,
          "fixture",
          path,
          value,
        ],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(0);
      expect(readFileSync(path, "utf8")).toBe(
        `ADMIN_API_URL=${value}\nKEEP=unchanged\n`,
      );
    } finally {
      rmSync(directory, { recursive: true });
    }
  });
  it.each([
    "deploy-production-release.sh",
    "bootstrap-owner.sh",
    "configure-host-access.sh",
  ])("%s uses a checked plan, not raw AUTH_MODE extraction", (name) => {
    const file = new URL(`../deploy/scripts/${name}`, import.meta.url);
    const source = readFileSync(file, "utf8");
    expect(source).toContain("--plan");
    expect(source).not.toContain("s/^AUTH_MODE=//p");
    expect(source).not.toContain("eval ");
    expect(spawnSync("sh", ["-n", file.pathname]).status).toBe(0);
  });
  it.each(["failure", "empty", "garbage", "multiple", "existing"])(
    "bootstrap count %s never invokes the owner-creation branch",
    (kind) => {
      const source = readFileSync(
        new URL("../deploy/scripts/bootstrap-owner.sh", import.meta.url),
        "utf8",
      );
      const start = source.indexOf("owner_count=$(sqlite3");
      const end = source.indexOf(
        'if [ "$(profile_field followUpOidcRegistration)',
        start,
      );
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      const sqlite =
        kind === "failure"
          ? "return 1"
          : `printf '%s' '${kind === "empty" ? "" : kind === "multiple" ? "2" : kind === "existing" ? "1" : "oops"}'`;
      const harness = `set -eu\nsqlite3() { ${sqlite}; }\nenv() { echo UNEXPECTED_OWNER_CREATION; return 99; }\ndatabase=unused\n${source.slice(start, end)}`;
      const result = spawnSync("sh", ["-c", harness], { encoding: "utf8" });
      expect(result.stdout).not.toContain("UNEXPECTED_OWNER_CREATION");
      expect(result.status).toBe(
        kind === "existing" ? 0 : kind === "multiple" ? 73 : 78,
      );
    },
  );
});
