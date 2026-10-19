import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import { importServerSetupReview } from "../packages/server-setup-core/src/index.mjs";
import {
  setupHtml,
  setupScript,
} from "../deploy/scripts/server-setup-assets.mjs";

// Small startup-state fixture, not a substitute for real browser CSS tests.
function element() {
  const label = { hidden: false };
  return {
    value: "",
    textContent: "",
    hidden: false,
    disabled: false,
    closest: () => label,
    append: () => {},
    replaceChildren: () => {},
    addEventListener: () => {},
    setAttribute: () => {},
  };
}

it.each([
  { auth: "password", ingress: false },
  { auth: "oidc", ingress: false },
  { auth: "cloudflare-access", ingress: false },
  { auth: "password", ingress: true },
])(
  "initializes legacy ingress=null settings for $auth (HTTPS change: $ingress)",
  async ({ auth, ingress }) => {
    const cloudflare = auth === "cloudflare-access";
    const model = importServerSetupReview(
      [
        `DEPLOYMENT_MODE=${cloudflare ? "cloudflare" : "standalone"}`,
        `AUTH_MODE=${auth}`,
        "PUBLIC_ORIGIN=https://renderer.example.test",
        "RENDERER_PUBLIC_URL=https://renderer.example.test",
        "OIDC_ISSUER=https://identity.example.test/tenant",
        "OIDC_CLIENT_ID=fixture-renderer",
        "CLOUDFLARE_ACCESS_ISSUER=https://fixture.cloudflareaccess.com",
        `CLOUDFLARE_ADMIN_AUDIENCE=${"a".repeat(64)}`,
        `CLOUDFLARE_REMOTE_MCP_AUDIENCE=${"b".repeat(64)}`,
        "DATABASE_PATH=/fixture/db",
        "STORAGE_ROOT=/fixture/storage",
        `RENDERER_IMAGE=sha256:${"a".repeat(64)}`,
      ].join("\n"),
    );
    expect(model.deployment.ingress).toBeNull();
    const elements = new Map(
      [...setupHtml.matchAll(/id="([^"]+)"/g)].map((match) => [
        match[1],
        element(),
      ]),
    );
    const get = (id: string) => {
      const value = elements.get(id);
      if (!value) throw new Error(`Missing setup element ${id}`);
      return value;
    };
    runInNewContext(setupScript, {
      document: { getElementById: get, createElement: element },
      location: { hash: "#fixture-bootstrap" },
      history: { replaceState: () => {} },
      structuredClone,
      fetch: (path: string) =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve(
              path === "/api/session"
                ? { token: "fixture-token", csrf: "fixture-csrf" }
                : {
                    scope: ingress
                      ? "ingress-prepared-host"
                      : "initial-prepared-host",
                    review: model,
                  },
            ),
        }),
    });
    await vi.waitFor(() =>
      expect(get("status").textContent).toContain("変更を入力"),
    );
    expect(get("owner-password").closest().hidden).toBe(
      ingress || auth !== "password",
    );
    expect(get("owner-subject").closest().hidden).toBe(
      ingress || auth === "password",
    );
    expect(get("oidc-secret").closest().hidden).toBe(
      ingress || auth !== "oidc",
    );
    expect(get("tls-key").closest().hidden).toBe(cloudflare);
    expect(get("credentials-heading").textContent).toBe(
      ingress ? "HTTPS証明書" : "管理者と認証情報",
    );
  },
);
