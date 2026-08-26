import { request } from "node:http";
import { Script } from "node:vm";
import {
  createSetupWebServer,
  type SetupWebActions,
  type SetupWebServer,
} from "@latex-renderer/setup-web";
import { afterEach, describe, expect, it } from "vitest";

describe("Local Setup Web UI", () => {
  let web: SetupWebServer | undefined;

  afterEach(async () => {
    await web?.close();
    web = undefined;
  });

  it("serves an external-script UI with strict browser security headers", async () => {
    web = await createSetupWebServer({ actions: actions() });
    const response = await fetch(web.origin);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-security-policy")).toContain(
      "script-src 'self'",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(html).toContain('src="/assets/setup.js"');
    expect(html).not.toMatch(/<script(?![^>]+src=)/);
    expect(html).not.toContain(new URL(web.bootstrapUrl).hash.slice(1));
    const script = await (await fetch(`${web.origin}/assets/setup.js`)).text();
    expect(() => new Script(script)).not.toThrow();
  });

  it("requires one-time bootstrap, exact Origin, session auth, and CSRF", async () => {
    const mocked = actions();
    web = await createSetupWebServer({ actions: mocked });
    const bootstrapToken = new URL(web.bootstrapUrl).hash.slice(1);

    const crossOrigin = await jsonRequest(
      web,
      "/api/session",
      { bootstrapToken },
      { origin: "https://attacker.example" },
    );
    expect(crossOrigin.response.status).toBe(403);
    expect(
      crossOrigin.response.headers.get("access-control-allow-origin"),
    ).toBeNull();

    const bootstrap = await jsonRequest(web, "/api/session", {
      bootstrapToken,
    });
    expect(bootstrap.response.status).toBe(200);
    const credentials = bootstrap.body.result as {
      sessionToken: string;
      csrfToken: string;
    };
    expect(credentials.sessionToken).toHaveLength(43);
    expect(credentials.csrfToken).toHaveLength(43);

    const reused = await jsonRequest(web, "/api/session", { bootstrapToken });
    expect(reused.response.status).toBe(401);

    const unauthenticated = await jsonRequest(web, "/api/status", {});
    expect(unauthenticated.response.status).toBe(401);

    const badCsrf = await jsonRequest(
      web,
      "/api/status",
      {},
      { sessionToken: credentials.sessionToken, csrfToken: "wrong" },
    );
    expect(badCsrf.response.status).toBe(403);

    const status = await jsonRequest(web, "/api/status", {}, credentials);
    expect(status.response.status).toBe(200);
    expect(status.body).toEqual({
      success: true,
      result: { status: "healthy" },
    });
  });

  it("rejects DNS rebinding and redacts secrets from action results", async () => {
    web = await createSetupWebServer({ actions: actions() });
    expect(await requestWithHost(web.origin, "attacker.example")).toBe(421);
    const credentials = await bootstrap(web);

    const auth = await jsonRequest(
      web,
      "/api/auth",
      { apiKey: `lrk_${"a".repeat(32)}_${"A".repeat(43)}` },
      credentials,
    );
    expect(auth.response.status).toBe(200);
    expect(auth.body.result).toEqual({
      apiKey: "[redacted]",
      credential: "[redacted]",
      message: "stored [redacted]",
    });
    expect(JSON.stringify(auth.body)).not.toContain("lrk_");

    const invalid = await jsonRequest(
      web,
      "/api/update",
      { skillTarget: "invalid", mcpTarget: "none" },
      credentials,
    );
    expect(invalid.response.status).toBe(400);
  });

  it("closes on an authenticated request", async () => {
    web = await createSetupWebServer({ actions: actions() });
    const credentials = await bootstrap(web);
    const response = await jsonRequest(web, "/api/close", {}, credentials);
    expect(response.response.status).toBe(200);
    await expect(web.closed).resolves.toEqual({ reason: "requested" });
    web = undefined;
  });
});

function actions(): SetupWebActions {
  return {
    status: () => Promise.resolve({ status: "healthy" }),
    doctor: () => Promise.resolve({ status: "healthy", checks: [] }),
    saveApiKey: (apiKey: string) =>
      Promise.resolve({
        apiKey,
        credential: true,
        message: `stored ${apiKey}`,
      }),
    removeApiKey: () => Promise.resolve({ removed: true }),
    update: (input) => Promise.resolve({ action: "current", input }),
    repair: (input) => Promise.resolve({ repaired: [], input }),
    sampleRender: () => Promise.resolve({ job: { status: "succeeded" } }),
  };
}

async function bootstrap(web: SetupWebServer): Promise<{
  sessionToken: string;
  csrfToken: string;
}> {
  const response = await jsonRequest(web, "/api/session", {
    bootstrapToken: new URL(web.bootstrapUrl).hash.slice(1),
  });
  return response.body.result as { sessionToken: string; csrfToken: string };
}

async function jsonRequest(
  web: SetupWebServer,
  path: string,
  body: Readonly<Record<string, unknown>>,
  credentials: {
    sessionToken?: string;
    csrfToken?: string;
    origin?: string;
  } = {},
): Promise<{
  response: Response;
  body: { success?: boolean; result?: unknown; error?: unknown };
}> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Origin: credentials.origin ?? web.origin,
    "Sec-Fetch-Site": "same-origin",
  };
  if (credentials.sessionToken !== undefined)
    headers.Authorization = `Bearer ${credentials.sessionToken}`;
  if (credentials.csrfToken !== undefined)
    headers["X-CSRF-Token"] = credentials.csrfToken;
  const response = await fetch(new URL(path, web.origin), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return {
    response,
    body: (await response.json()) as {
      success?: boolean;
      result?: unknown;
      error?: unknown;
    },
  };
}

function requestWithHost(origin: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const operation = request(
      origin,
      { headers: { Host: host } },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode ?? 0));
      },
    );
    operation.once("error", reject);
    operation.end();
  });
}
