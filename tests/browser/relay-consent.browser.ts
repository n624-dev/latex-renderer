import { once } from "node:events";
import { createServer, type Server } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  BrowserAuthenticationService,
  SESSION_COOKIE,
} from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import { expect, it, vi } from "vitest";
import { createRemoteMcpApp } from "../../apps/remote-mcp/src/app.js";
import { createRemoteMcpHandler } from "../../apps/remote-mcp/src/mcp.js";
import {
  createLocalRelay,
  localApprovalPath,
} from "../../apps/remote-mcp/src/relay-agent.js";
import { LocalRelayGrants } from "../../apps/remote-mcp/src/relay-grants.js";
import {
  RemoteOAuthService,
  RemoteRenderService,
} from "../../packages/remote-mcp-core/src/index.js";
import { ingressTlsFixture } from "../fixtures/server-ingress.js";
import { launchTestBrowser, newTestPage } from "../helpers/browser-engine.js";

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("No browser fixture address");
  return `https://127.0.0.1:${address.port}`;
}

async function forward(
  handle: (request: Request) => Promise<Response> | Response,
  origin: string,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming.headers))
    if (value !== undefined)
      headers.set(key, Array.isArray(value) ? value.join(",") : value);
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) {
    if (!Buffer.isBuffer(chunk)) throw new Error("Expected a binary chunk");
    chunks.push(chunk);
  }
  const response = await handle(
    new Request(new URL(incoming.url ?? "/", origin), {
      method: incoming.method ?? "GET",
      headers,
      ...(chunks.length
        ? { body: Buffer.concat(chunks).toString("utf8") }
        : {}),
    }),
  );
  outgoing.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key !== "set-cookie") outgoing.setHeader(key, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) outgoing.setHeader("Set-Cookie", cookies);
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}

function agentPath(input: Parameters<typeof fetch>[0]) {
  return new URL(input instanceof Request ? input.url : input).pathname;
}

it("approves and revokes relay access through native HTTPS forms with strict Origin and CSRF checks", async () => {
  const tls = ingressTlsFixture();
  const database = new RendererDatabase(":memory:");
  const grants = new LocalRelayGrants(":memory:");
  const https = { key: tls.key, cert: tls.certificate };
  const renderer = createServer(https);
  const foreign = createServer(https, (_incoming, outgoing) => {
    outgoing.setHeader("Content-Type", "text/html");
    outgoing.end("<!doctype html><title>Foreign origin fixture</title>");
  });
  try {
    const origin = await listen(renderer);
    const foreignOrigin = await listen(foreign);
    const url = `${origin}${localApprovalPath}`;
    const userId = "user_test";
    const password = "relay consent browser fixture password";
    database.migrate();
    database.users.insertInvitation({
      id: userId,
      email: "user@example.test",
      displayName: "Relay user",
      role: "admin",
      createdBy: "test",
      timestamp: new Date().toISOString(),
    });
    const browserAuth = new BrowserAuthenticationService({
      database,
      publicOrigin: origin,
      mode: "password",
      passwordPepper: Buffer.alloc(32, 4),
      scryptLogN: 12,
    });
    await browserAuth.createPasswordCredential({
      userId,
      loginName: "relay-user",
      password,
    });
    const session = await browserAuth.loginPassword({
      loginName: "relay-user",
      password,
      ipAddress: "127.0.0.1",
      request: new Request(origin, {
        method: "POST",
        headers: { Origin: origin },
      }),
    });
    const oauth = new RemoteOAuthService(database, origin, `${origin}/mcp`);
    const mcp = createRemoteMcpHandler(
      new RemoteRenderService(
        database,
        tls.root,
        "renderer:test",
        origin,
        100,
        1024 ** 3,
      ),
      "test",
    );
    const deps = { database, browserAuth, oauth, mcp, publicOrigin: origin };
    const agent = vi.fn<typeof fetch>().mockImplementation((input) => {
      if (agentPath(input) === "/pair/claim")
        return Promise.resolve(
          Response.json({
            id: "claim-fixture",
            nonce: "nonce-fixture",
            clientId: "Browser client",
            scopes: ["mcp:read", "mcp:cancel"],
            expiresAt: Date.now() + 60_000,
          }),
        );
      return Promise.resolve(Response.json(true));
    });
    const relay = createLocalRelay(deps, {
      grants,
      relayFetch: agent,
      instanceId: "instance-fixture",
      agentOrigin: "http://127.0.0.1:3111",
      secret: "local-agent-fixture",
    });
    const app = createRemoteMcpApp({ ...deps, localRelay: relay.handle });
    renderer.on("request", (incoming, outgoing) => {
      void forward(app.fetch, origin, incoming, outgoing).catch(
        (error: unknown) => {
          outgoing.destroy(
            error instanceof Error ? error : new Error(String(error)),
          );
        },
      );
    });
    const browser = await launchTestBrowser();
    try {
      const page = await newTestPage(browser, { ignoreHTTPSErrors: true });
      await page.context().addCookies([
        {
          name: SESSION_COOKIE,
          value: session.token,
          url: origin,
          secure: true,
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      const submit = async (name: string, expectedOrigin: string) => {
        const [response] = await Promise.all([
          page.waitForResponse(
            (value) =>
              value.url() === url && value.request().method() === "POST",
          ),
          page.getByRole("button", { name, exact: true }).click(),
        ]);
        expect(await response.request().headerValue("origin")).toBe(
          expectedOrigin,
        );
        expect(await response.request().headerValue("cookie")).toContain(
          `${SESSION_COOKIE}=`,
        );
        return response;
      };

      const form = await page.goto(url);
      expect(form?.status()).toBe(200);
      expect(await form?.headerValue("referrer-policy")).toBe("same-origin");
      const csrf = await page.locator("input[name=csrf]").first().inputValue();

      await page.goto(foreignOrigin);
      await page.setContent(
        `<form method="post" action="${url}"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="code" value="12345678"><button name="action" value="claim">Continue</button></form>`,
      );
      const foreignPost = await submit("Continue", foreignOrigin);
      expect(foreignPost.status()).toBe(403);
      expect(await foreignPost.request().headerValue("cookie")).toContain(
        "relay_csrf=",
      );
      expect(await foreignPost.json()).toMatchObject({
        error: { code: "ORIGIN_REJECTED" },
      });
      expect(agent).not.toHaveBeenCalled();

      await page.goto(url);
      await page.getByLabel("Connection code").fill("12345678");
      await page
        .locator("input[name=csrf]")
        .first()
        .evaluate((input: HTMLInputElement) => {
          input.value = "invalid";
        });
      expect((await submit("Continue", origin)).status()).toBe(403);
      expect(agent).not.toHaveBeenCalled();

      await page.goto(url);
      await page.getByLabel("Connection code").fill("12345678");
      expect((await submit("Continue", origin)).status()).toBe(200);
      await page.getByLabel("Allow cancelling render jobs").check();
      expect((await submit("Approve access", origin)).status()).toBe(200);
      expect(await page.locator("body").innerText()).toContain(
        "Access approved",
      );
      expect(grants.list(userId, Date.now())).toMatchObject([
        { scopes: ["mcp:read", "mcp:cancel"] },
      ]);

      await page.goto(url);
      expect((await submit("Disconnect", origin)).status()).toBe(303);
      expect(grants.list(userId, Date.now())).toEqual([]);
      expect(agent.mock.calls.map(([input]) => agentPath(input))).toEqual([
        "/pair/claim",
        "/pair/approve",
        "/pair/revoke",
      ]);
    } finally {
      await browser.close();
    }
  } finally {
    await Promise.all(
      [renderer, foreign].map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
            server.closeAllConnections();
          }),
      ),
    );
    grants.close();
    database.close();
    tls.cleanup();
  }
});
