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
  const events = new Map<
    string,
    (event: { preventDefault(): void }) => unknown
  >();
  return {
    events,
    value: "",
    textContent: "",
    hidden: false,
    disabled: false,
    closest: () => label,
    append: () => {},
    replaceChildren: () => {},
    addEventListener: (
      name: string,
      handler: (event: { preventDefault(): void }) => unknown,
    ) => {
      events.set(name, handler);
    },
    setAttribute: () => {},
  };
}

it.each(["mismatch", "connection-lost", "reply-lost", "success"])(
  "distinguishes setup input failure from submitted apply uncertainty (%s)",
  async (scenario) => {
    const imported = importServerSetupReview(
      [
        "DEPLOYMENT_MODE=standalone",
        "AUTH_MODE=password",
        "PUBLIC_ORIGIN=https://renderer.example.test",
        "RENDERER_PUBLIC_URL=https://renderer.example.test",
        "DATABASE_PATH=/fixture/db",
        "STORAGE_ROOT=/fixture/storage",
        `RENDERER_IMAGE=sha256:${"a".repeat(64)}`,
      ].join("\n"),
    );
    const model = {
      ...imported,
      deployment: { ...imported.deployment, ingress: { mode: "standalone" } },
    };
    const elements = new Map(
      [...setupHtml.matchAll(/id="([^"]+)"/g)].map((match) => [
        match[1] ?? "",
        element(),
      ]),
    );
    const get = (id: string) => {
      const found = elements.get(id);
      if (!found) throw new Error(`Missing ${id}`);
      return found;
    };
    let submitted = 0,
      applied = 0;
    runInNewContext(setupScript, {
      document: { getElementById: get, createElement: element },
      location: { hash: "#fixture" },
      history: { replaceState: () => {} },
      structuredClone,
      fetch: (path: string) => {
        if (path === "/api/apply") {
          submitted++;
          if (scenario !== "connection-lost") applied++;
          if (scenario === "connection-lost" || scenario === "reply-lost")
            return Promise.reject(new Error("Fixture transport interruption"));
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve(
              path === "/api/session"
                ? { token: "fixture-token", csrf: "fixture-csrf" }
                : path === "/api/preview"
                  ? { review: model, confirmation: "fixture-confirmation" }
                  : { scope: "initial-prepared-host", review: model },
            ),
        });
      },
    });
    await vi.waitFor(() =>
      expect(get("status").textContent).toContain("変更を入力"),
    );
    get("owner-password").value = "fixture-password";
    get("owner-confirm").value =
      scenario === "mismatch" ? "different" : "fixture-password";
    get("oidc-secret").value = "fixture-oidc-secret";
    get("tls-key").value = "fixture-private-key";
    const event = { preventDefault() {} };
    const dispatch = async (id: string, name: string) => {
      const handler = get(id).events.get(name);
      if (!handler) throw new Error(`Missing ${id} ${name}`);
      await handler(event);
    };
    await dispatch("settings", "submit");
    await dispatch("apply", "click");
    if (scenario === "mismatch") {
      expect(submitted).toBe(0);
      expect(get("status").textContent).toContain(
        "パスワードの確認が一致しません",
      );
      expect(get("fields").disabled).toBe(false);
      expect(get("apply").disabled).toBe(false);
      expect(get("close").disabled).toBe(false);
      expect(get("owner-password").value).toBe("fixture-password");
      expect(get("oidc-secret").value).toBe("fixture-oidc-secret");
      expect(get("tls-key").value).toBe("fixture-private-key");
      get("owner-confirm").value = "fixture-password";
      await dispatch("apply", "click");
      expect(submitted).toBe(1);
      expect(get("status").textContent).toContain("適用完了");
    } else {
      expect(submitted).toBe(1);
      expect(applied).toBe(scenario === "connection-lost" ? 0 : 1);
      expect(get("owner-password").value).toBe("");
      expect(get("tls-key").value).toBe("");
      if (scenario === "success")
        expect(get("status").textContent).toContain("適用完了");
      else {
        expect(get("status").textContent).toContain("復旧ボタン");
        expect(get("recover").hidden).toBe(false);
        expect(get("fields").disabled).toBe(true);
      }
    }
  },
);

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
