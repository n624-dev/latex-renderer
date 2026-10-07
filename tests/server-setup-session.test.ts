import { request } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createServerSetupSession,
  importServerSetupReview,
  type ServerSetupSessionHost,
  type ServerSetupReview,
} from "../packages/server-setup-core/src/index.mjs";
import { runServerSetupCui } from "../deploy/scripts/server-setup-cui.mjs";
import { startServerSetupWeb } from "../deploy/scripts/server-setup-web.mjs";

const env = [
  "DEPLOYMENT_MODE=standalone",
  "AUTH_MODE=password",
  "PUBLIC_ORIGIN=https://renderer.example.test",
  "RENDERER_PUBLIC_URL=https://renderer.example.test",
  "DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3",
  "STORAGE_ROOT=/var/lib/latex-renderer/storage",
  `RENDERER_IMAGE=sha256:${"a".repeat(64)}`,
  "PRIVATE_SECRET=do-not-send-this-to-browser",
  "",
].join("\n");
const model = () => {
  const review = importServerSetupReview(env);
  return {
    ...review,
    runtime: { ...review.runtime, limits: { ...review.runtime.limits } },
  };
};
function fixture() {
  const current = vi.fn(() => model());
  const preview = vi.fn((review: ServerSetupReview) => ({
    review,
    internal: "private-adapter-data",
  }));
  const apply = vi.fn<ServerSetupSessionHost["apply"]>(() => {});
  const host: ServerSetupSessionHost = { current, preview, apply };
  return { current, preview, apply, host };
}
const webServers: Awaited<ReturnType<typeof startServerSetupWeb>>[] = [];
afterEach(async () => {
  for (const server of webServers.splice(0)) {
    server.close();
    await server.closed;
  }
});
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("common server setup session", () => {
  it.each([
    {},
    {
      listenAddress: "0.0.0.0",
      acknowledgePlaintextLan: true,
      allowedNetworks: ["10.0.0.0/8"],
    },
    { listenAddress: "192.168.1.10", allowedNetworks: ["192.168.1.0/24"] },
    {
      listenAddress: "192.168.1.10",
      acknowledgePlaintextLan: true,
      allowedNetworks: ["0.0.0.0/0"],
    },
    {
      listenAddress: "172.16.1.10",
      acknowledgePlaintextLan: true,
      allowedNetworks: ["172.0.0.0/8"],
    },
  ])(
    "rejects implicit/public/unassigned LAN bootstrap %j before opening a listener",
    async (options) => {
      const selected = Object.keys(options).length
        ? options
        : {
            listenAddress: "192.168.1.10",
            allowedNetworks: ["192.168.1.0/24"],
            acknowledgePlaintextLan: true,
          };
      await expect(
        startServerSetupWeb(fixture().host, { ...selected, interfaces: {} }),
      ).rejects.toThrow("EXPLICIT_TRUSTED_LAN_REQUIRED");
    },
  );
  it("only returns checked non-secret state and never writes on status/preview", async () => {
    const f = fixture(),
      session = createServerSetupSession(f.host);
    expect(await session.status()).toEqual({
      phase: "editing",
      scope: "existing-prepared-host",
      review: model(),
    });
    expect(await session.status()).toMatchObject({ phase: "editing" });
    expect(f.current).toHaveBeenCalledTimes(1);
    const result = await session.preview(model());
    expect(result.confirmation).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE_SECRET|private-adapter-data|do-not-send/,
    );
    expect(result.readiness.readyForApply).toBe(false);
    expect(f.apply).not.toHaveBeenCalled();
  });
  it("binds one-use approval to the exact reviewed candidate and never reuses approval", async () => {
    const f = fixture(),
      session = createServerSetupSession(f.host);
    const first = await session.preview(model());
    const changed = model();
    changed.runtime.limits.maxQueueLength = 42;
    const second = await session.preview(changed);
    await expect(session.apply(first.confirmation)).rejects.toThrow(
      "REVIEW_CONFIRMATION_REQUIRED",
    );
    await session.apply(second.confirmation);
    expect(f.apply).toHaveBeenCalledExactlyOnceWith({
      review: changed,
      internal: "private-adapter-data",
    });
    await expect(session.apply(second.confirmation)).rejects.toThrow(
      "SESSION_COMPLETE",
    );
    await expect(session.preview(model())).rejects.toThrow("SESSION_COMPLETE");
  });
  it.each([null, "", "é".repeat(43), {}, "a".repeat(43)])(
    "rejects malformed approval %j without invoking the adapter",
    async (value) => {
      const f = fixture(),
        session = createServerSetupSession(f.host);
      await session.preview(model());
      await expect(session.apply(value)).rejects.toThrow(
        "REVIEW_CONFIRMATION_REQUIRED",
      );
      expect(f.apply).not.toHaveBeenCalled();
    },
  );
  it("invalidates an earlier review if the replacement is invalid", async () => {
    const f = fixture(),
      session = createServerSetupSession(f.host);
    const first = await session.preview(model());
    await expect(
      session.preview({ ...model(), secret: "private" }),
    ).rejects.toThrow("INVALID_REVIEW");
    await expect(session.apply(first.confirmation)).rejects.toThrow(
      "REVIEW_CONFIRMATION_REQUIRED",
    );
    expect(f.preview).toHaveBeenCalledTimes(1);
  });
  it("does not invoke object getters or leak host errors", async () => {
    const f = fixture(),
      session = createServerSetupSession(f.host);
    const getter = vi.fn();
    await expect(
      session.preview(
        Object.defineProperty(model(), "runtime", { get: getter }),
      ),
    ).rejects.toThrow("INVALID_REVIEW");
    expect(getter).not.toHaveBeenCalled();
    f.preview.mockImplementation(() => {
      throw new Error("secret-url-and-password");
    });
    await expect(session.preview(model())).rejects.toThrow(
      /^HOST_REVIEW_FAILED$/,
    );
    f.current.mockImplementation(() => {
      throw new Error("private-environment");
    });
    await expect(session.status()).rejects.toThrow(/^HOST_UNAVAILABLE$/);
  });
  it("serializes mutations and does not cancel a running host transaction", async () => {
    const f = fixture(),
      gate = deferred();
    const apply = vi.fn(() => gate.promise);
    const session = createServerSetupSession({ ...f.host, apply });
    const review = await session.preview(model());
    const running = session.apply(review.confirmation);
    await expect(session.status()).rejects.toThrow("SESSION_BUSY");
    await expect(session.preview(model())).rejects.toThrow("SESSION_BUSY");
    expect(() => session.close()).toThrow("SESSION_BUSY");
    gate.resolve();
    await running;
    expect(apply).toHaveBeenCalledTimes(1);
  });
  it("fails closed after a partial apply and requires a new review, not an automatic retry", async () => {
    const f = fixture();
    f.apply.mockImplementation(() => {
      throw new Error("secret ENOSPC");
    });
    const session = createServerSetupSession(f.host),
      review = await session.preview(model());
    await expect(session.apply(review.confirmation)).rejects.toThrow(
      /^APPLY_FAILED_RECOVERY_MAY_BE_REQUIRED$/,
    );
    await expect(session.apply(review.confirmation)).rejects.toThrow(
      "REVIEW_CONFIRMATION_REQUIRED",
    );
    expect(f.apply).toHaveBeenCalledTimes(1);
  });
  it("expires using a monotonic clock and never extends expiry on reads/reviews", async () => {
    let clock = 0;
    const f = fixture(),
      session = createServerSetupSession(f.host, {
        clock: () => clock,
        lifetimeMs: 1000,
      });
    const review = await session.preview(model());
    clock = 999;
    await session.status();
    clock = 1000;
    await expect(session.apply(review.confirmation)).rejects.toThrow(
      "SESSION_CLOSED",
    );
    expect(f.apply).not.toHaveBeenCalled();
  });
  it.each([0, -1, 0.5, 7_200_001, NaN])(
    "validates session lifetime %s",
    (lifetimeMs) => {
      expect(() =>
        createServerSetupSession(fixture().host, { lifetimeMs }),
      ).toThrow("INVALID_LIFETIME");
    },
  );
  it("bounds preview operations per session", async () => {
    const f = fixture(),
      session = createServerSetupSession(f.host);
    for (let i = 0; i < 128; i++) await session.preview(model());
    await expect(session.preview(model())).rejects.toThrow("REVIEW_LIMIT");
    expect(f.preview).toHaveBeenCalledTimes(128);
  });
});

describe("CUI adapter", () => {
  it("accepts the same complete advanced review as Web without a file/editor/terminal switch", async () => {
    const f = fixture(),
      changed = model();
    changed.runtime.limits.maxQueueLength = 64;
    await runServerSetupCui(f.host, {
      ask: (prompt) =>
        Promise.resolve(
          prompt.startsWith("Optional full") ? JSON.stringify(changed) : "",
        ),
      print: () => {},
    });
    expect(f.preview).toHaveBeenCalledExactlyOnceWith(changed);
    expect(f.apply).not.toHaveBeenCalled();
  });
  it.each(["APPLY", "cancel"])(
    "reviews the same model before %s",
    async (answer) => {
      const f = fixture(),
        lines: string[] = [];
      const result = await runServerSetupCui(f.host, {
        ask: (prompt) =>
          Promise.resolve(
            prompt.startsWith("maxQueueLength")
              ? "42"
              : prompt.startsWith("Type APPLY")
                ? answer
                : "",
          ),
        print: (line) => lines.push(line),
      });
      expect(f.preview.mock.calls[0]?.[0].runtime.limits.maxQueueLength).toBe(
        42,
      );
      expect(result.applied).toBe(answer === "APPLY");
      expect(f.apply).toHaveBeenCalledTimes(answer === "APPLY" ? 1 : 0);
      expect(lines.join("\n")).not.toContain("private-adapter-data");
    },
  );
  it("does not apply if prompting is interrupted", async () => {
    const f = fixture();
    await expect(
      runServerSetupCui(f.host, {
        ask: () => Promise.reject(new Error("terminal closed")),
        print: () => {},
      }),
    ).rejects.toThrow("terminal closed");
    expect(f.apply).not.toHaveBeenCalled();
  });
});

async function webFixture() {
  const f = fixture(),
    web = await startServerSetupWeb(f.host);
  webServers.push(web);
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(`${web.origin}${path}`, {
      method: "POST",
      headers: {
        Origin: web.origin,
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  const response = await post("/api/session", {
    bootstrap: new URL(web.bootstrapUrl).hash.slice(1),
  });
  const credentials = (await response.json()) as {
    token: string;
    csrf: string;
  };
  const headers = {
    Authorization: `Bearer ${credentials.token}`,
    "X-CSRF-Token": credentials.csrf,
  };
  return { ...f, web, post, headers };
}

describe("short-lived loopback Web adapter", () => {
  it("automatically closes an idle listener", async () => {
    const f = fixture(),
      web = await startServerSetupWeb(f.host, {
        lifetimeMs: 2000,
        idleMs: 1000,
      });
    webServers.push(web);
    await web.closed;
    expect(f.apply).not.toHaveBeenCalled();
    await expect(fetch(web.origin)).rejects.toThrow();
  });
  it("does not let idle expiry cancel a running bounded host transaction", async () => {
    const f = fixture(),
      gate = deferred(),
      apply = vi.fn(() => gate.promise);
    const web = await startServerSetupWeb(
      { ...f.host, apply },
      { lifetimeMs: 5000, idleMs: 1000 },
    );
    webServers.push(web);
    const post = (
      path: string,
      body: unknown,
      headers: Record<string, string> = {},
    ) =>
      fetch(`${web.origin}${path}`, {
        method: "POST",
        headers: {
          Origin: web.origin,
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
      });
    const credentials = (await (
      await post("/api/session", {
        bootstrap: new URL(web.bootstrapUrl).hash.slice(1),
      })
    ).json()) as { token: string; csrf: string };
    const headers = {
      Authorization: `Bearer ${credentials.token}`,
      "X-CSRF-Token": credentials.csrf,
    };
    const reviewed = (await (
      await post("/api/preview", { review: model() }, headers)
    ).json()) as { confirmation: string };
    const pending = post(
      "/api/apply",
      { confirmation: reviewed.confirmation },
      headers,
    );
    try {
      await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      await delay(1200);
      expect((await post("/api/status", {}, headers)).status).toBe(409);
      expect(
        (
          await post(
            "/api/apply",
            { confirmation: reviewed.confirmation },
            headers,
          )
        ).status,
      ).toBe(409);
    } finally {
      gate.resolve();
    }
    expect((await pending).status).toBe(200);
    await web.closed;
  });
  it("serves a CSP-protected secret-free UI and exchanges the bootstrap only once", async () => {
    const f = await webFixture();
    const response = await fetch(f.web.origin);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    const html = await response.text();
    expect(html).not.toContain(new URL(f.web.bootstrapUrl).hash.slice(1));
    expect(html).not.toContain("do-not-send-this-to-browser");
    expect(
      (
        await f.post("/api/session", {
          bootstrap: new URL(f.web.bootstrapUrl).hash.slice(1),
        })
      ).status,
    ).toBe(403);
    expect((await f.post("/api/status", {}, f.headers)).status).toBe(200);
  });
  it.each([
    { Origin: "https://attacker.example.test" },
    { Origin: "" },
    { "X-CSRF-Token": "wrong" },
    { Authorization: "wrong" },
  ])("rejects forged origin/host/session/CSRF %j", async (extra) => {
    const f = await webFixture();
    expect(
      (
        await f.post(
          "/api/preview",
          { review: model() },
          { ...f.headers, ...extra },
        )
      ).status,
    ).toBe(403);
    expect(f.preview).not.toHaveBeenCalled();
  });
  it("rejects a forged Host on the actual HTTP wire, regardless of forwarding headers", async () => {
    const f = await webFixture();
    // Node fetch rewrites Host. Use raw HTTP to test the listener, not fetch's
    // filtering of forbidden request headers.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        `${f.web.origin}/api/preview`,
        {
          method: "POST",
          headers: {
            ...f.headers,
            Host: "attacker.example.test",
            Origin: f.web.origin,
            "Content-Type": "application/json",
            "X-Forwarded-Host": new URL(f.web.origin).host,
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ review: model() }));
    });
    expect(status).toBe(403);
    expect(f.preview).not.toHaveBeenCalled();
  });
  it("requires exact action fields and bounded JSON, and never exposes adapter errors", async () => {
    const f = await webFixture();
    expect(
      (
        await f.post(
          "/api/preview",
          { review: model(), command: "shell" },
          f.headers,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await f.post(
          "/api/preview",
          { review: "x".repeat(129 * 1024) },
          f.headers,
        )
      ).status,
    ).toBe(413);
    f.preview.mockImplementation(() => {
      throw new Error("secret value");
    });
    const response = await f.post(
      "/api/preview",
      { review: model() },
      f.headers,
    );
    expect(await response.json()).toEqual({ code: "HOST_REVIEW_FAILED" });
  });
  it("rejects unrecognized routes, queries and GET mutations", async () => {
    const f = await webFixture();
    expect((await f.post("/api/shell", {}, f.headers)).status).toBe(404);
    expect(
      (await f.post("/api/status?bootstrap=secret", {}, f.headers)).status,
    ).toBe(403);
    expect((await fetch(`${f.web.origin}/api/apply`)).status).toBe(404);
    expect(f.apply).not.toHaveBeenCalled();
  });
  it("applies only after an exact review and immediately closes the bootstrap listener", async () => {
    const f = await webFixture();
    const checked = (await (
      await f.post("/api/preview", { review: model() }, f.headers)
    ).json()) as { confirmation: string };
    const response = await f.post(
      "/api/apply",
      { confirmation: checked.confirmation },
      f.headers,
    );
    expect(await response.json()).toEqual({ phase: "complete" });
    await f.web.closed;
    expect(f.apply).toHaveBeenCalledTimes(1);
    await expect(fetch(f.web.origin)).rejects.toThrow();
  });
  it("disposes the listener on explicit close without applying", async () => {
    const f = await webFixture();
    expect((await f.post("/api/close", {}, f.headers)).status).toBe(200);
    await f.web.closed;
    expect(f.apply).not.toHaveBeenCalled();
  });
});
