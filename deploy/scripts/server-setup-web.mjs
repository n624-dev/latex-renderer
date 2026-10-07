import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout, clearTimeout } from "node:timers";
import { URL } from "node:url";
import { networkInterfaces } from "node:os";
import { isIP } from "node:net";
import {
  createServerSetupSession,
  ServerSetupSessionError,
  serverIngressContainsAddress,
  validateServerIngressReview,
} from "../../packages/server-setup-core/src/index.mjs";
import { setupHtml, setupScript, setupStyle } from "./server-setup-assets.mjs";

const token = () => randomBytes(32).toString("base64url");
function equal(actual, expected) {
  return (
    typeof actual === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(actual) &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}
function record(value, keys) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key))
  )
    throw new ServerSetupSessionError("INVALID_REQUEST");
  return value;
}
async function readBody(request, maximum = 128 * 1024) {
  if (
    request.headers["content-type"] !== "application/json" ||
    request.headers["content-encoding"] !== undefined
  )
    throw new ServerSetupSessionError("INVALID_REQUEST");
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maximum)
      throw new ServerSetupSessionError("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ServerSetupSessionError("INVALID_REQUEST");
  }
}

/** Short-lived bootstrap, loopback by default, not a production route/service.
 * Private LAN requires explicit operator acknowledgement and an allowlist.
 * No wildcard listener, shell command, secret-file path or arbitrary host
 * action can be requested by the browser. Prefer SSH forwarding.
 */
export async function startServerSetupWeb(host, options = {}) {
  const listenAddress = options.listenAddress ?? "127.0.0.1";
  const networks = options.allowedNetworks ?? [];
  const lan = listenAddress !== "127.0.0.1";
  if (lan) {
    const assigned = Object.values(options.interfaces ?? networkInterfaces())
      .flat()
      .some((entry) => entry?.address === listenAddress);
    const privateAddress = [
      "10.0.0.0/8",
      "172.16.0.0/12",
      "192.168.0.0/16",
    ].some((network) => serverIngressContainsAddress(network, listenAddress));
    if (
      options.acknowledgePlaintextLan !== true ||
      isIP(listenAddress) !== 4 ||
      !assigned ||
      !privateAddress ||
      !Array.isArray(networks) ||
      !networks.length ||
      networks.length > 32 ||
      networks.some((network) => !/^(?:10\.|172\.|192\.168\.)/.test(network)) ||
      !networks.some((network) =>
        serverIngressContainsAddress(network, listenAddress),
      )
    )
      throw new ServerSetupSessionError("EXPLICIT_TRUSTED_LAN_REQUIRED");
    validateServerIngressReview({
      format: 1,
      mode: "standalone",
      publicOrigin: "https://bootstrap.example.test",
      accessScope: "lan",
      tlsProvider: "custom",
      listenAddress,
      allowedNetworks: networks,
    });
  } else if (networks.length)
    throw new ServerSetupSessionError("EXPLICIT_TRUSTED_LAN_REQUIRED");
  const lifetimeMs = options.lifetimeMs ?? 30 * 60_000;
  const idleMs = options.idleMs ?? 10 * 60_000;
  if (!Number.isSafeInteger(idleMs) || idleMs < 1000 || idleMs > lifetimeMs)
    throw new ServerSetupSessionError("INVALID_LIFETIME");
  const session = createServerSetupSession(host, { lifetimeMs });
  const bootstrap = token(),
    sessionToken = token(),
    csrf = token();
  const bootstrapUntil = performance.now() + Math.min(5 * 60_000, lifetimeMs);
  let exchanged = false,
    failures = 0,
    origin,
    applying = false,
    closed = false,
    idle,
    deadline;
  const sockets = new Set();
  const server = createServer((request, response) => {
    void handle(request, response);
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 1000;
  server.maxHeadersCount = 40;
  server.maxConnections = 8;
  server.maxRequestsPerSocket = 50;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("clientError", (_error, socket) => {
    socket.destroy();
  });
  function shutdown() {
    if (closed) return;
    closed = true;
    clearTimeout(idle);
    clearTimeout(deadline);
    server.close();
    for (const socket of sockets) socket.destroy();
    // A running host transaction owns its durable recovery. Do not cancel it
    // merely because the ephemeral frontend expires or the browser disconnects.
    try {
      session.close();
    } catch {
      /* busy: finish the host operation */
    }
  }
  function touch() {
    clearTimeout(idle);
    if (applying || closed) return;
    idle = setTimeout(shutdown, idleMs);
    idle.unref();
  }
  function send(response, status, body, type = "application/json") {
    response.writeHead(status, {
      "Content-Type": `${type}; charset=utf-8`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    response.end(type === "application/json" ? JSON.stringify(body) : body);
  }
  async function handle(request, response) {
    try {
      if (
        closed ||
        !(lan
          ? networks.some((network) =>
              serverIngressContainsAddress(
                network,
                request.socket.remoteAddress,
              ),
            )
          : request.socket.remoteAddress === "127.0.0.1") ||
        request.headers.host !== new URL(origin).host
      )
        throw new ServerSetupSessionError("FORBIDDEN");
      if (!request.url?.startsWith("/") || request.url.startsWith("//"))
        throw new ServerSetupSessionError("FORBIDDEN");
      const url = new URL(request.url, origin);
      if (url.origin !== origin || url.search || url.hash)
        throw new ServerSetupSessionError("FORBIDDEN");
      if (request.method === "GET") {
        const assets = {
          "/": [setupHtml, "text/html"],
          "/script.js": [setupScript, "text/javascript"],
          "/style.css": [setupStyle, "text/css"],
        };
        if (!Object.hasOwn(assets, url.pathname))
          throw new ServerSetupSessionError("NOT_FOUND");
        send(response, 200, ...assets[url.pathname]);
        return;
      }
      if (request.method !== "POST" || request.headers.origin !== origin)
        throw new ServerSetupSessionError("FORBIDDEN");
      if (
        ![
          "/api/session",
          "/api/status",
          "/api/preview",
          "/api/apply",
          "/api/close",
          "/api/recover",
        ].includes(url.pathname)
      )
        throw new ServerSetupSessionError("NOT_FOUND");
      if (
        url.pathname !== "/api/session" &&
        (!exchanged ||
          !equal(
            /^Bearer ([A-Za-z0-9_-]{43})$/.exec(
              request.headers.authorization ?? "",
            )?.[1],
            sessionToken,
          ) ||
          !equal(request.headers["x-csrf-token"], csrf))
      )
        throw new ServerSetupSessionError("FORBIDDEN");
      const body = await readBody(
        request,
        ["initial-prepared-host", "ingress-prepared-host"].includes(
          host.scope,
        ) && url.pathname === "/api/apply"
          ? 768 * 1024
          : 128 * 1024,
      );
      if (url.pathname === "/api/session") {
        record(body, ["bootstrap"]);
        if (
          exchanged ||
          performance.now() >= bootstrapUntil ||
          !equal(body.bootstrap, bootstrap)
        ) {
          if (++failures >= 8) response.once("finish", shutdown);
          throw new ServerSetupSessionError("FORBIDDEN");
        }
        exchanged = true;
        touch();
        send(response, 200, { token: sessionToken, csrf });
        return;
      }
      touch();
      if (url.pathname === "/api/status") {
        record(body, []);
        send(response, 200, await session.status());
      } else if (url.pathname === "/api/preview") {
        record(body, ["review"]);
        send(response, 200, await session.preview(body.review));
      } else if (url.pathname === "/api/apply") {
        record(
          body,
          ["initial-prepared-host", "ingress-prepared-host"].includes(
            host.scope,
          )
            ? ["confirmation", "credentials"]
            : ["confirmation"],
        );
        if (applying) throw new ServerSetupSessionError("SESSION_BUSY");
        applying = true;
        clearTimeout(idle);
        try {
          const result = await session.apply(
            body.confirmation,
            body.credentials,
          );
          response.once("finish", shutdown);
          send(response, 200, result);
        } finally {
          applying = false;
          touch();
        }
      } else if (url.pathname === "/api/recover") {
        record(body, ["confirmation"]);
        if (body.confirmation !== "RECOVER")
          throw new ServerSetupSessionError("INVALID_REQUEST");
        if (applying) throw new ServerSetupSessionError("SESSION_BUSY");
        applying = true;
        clearTimeout(idle);
        try {
          const result = await session.recover();
          if (result.phase === "complete") response.once("finish", shutdown);
          send(response, 200, result);
        } finally {
          applying = false;
          touch();
        }
      } else {
        record(body, []);
        session.close();
        response.once("finish", shutdown);
        send(response, 200, { closed: true });
      }
    } catch (error) {
      const code =
        error instanceof ServerSetupSessionError
          ? error.code
          : "REQUEST_FAILED";
      const status =
        code === "FORBIDDEN"
          ? 403
          : code === "NOT_FOUND"
            ? 404
            : code === "SESSION_BUSY"
              ? 409
              : code === "REQUEST_TOO_LARGE"
                ? 413
                : 400;
      if (!response.headersSent && !response.destroyed)
        send(response, status, { code });
    }
  }
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, listenAddress, resolve);
  });
  const address = server.address();
  origin = `http://${listenAddress}:${address.port}`;
  touch();
  deadline = setTimeout(shutdown, lifetimeMs);
  deadline.unref();
  return Object.freeze({
    origin,
    bootstrapUrl: `${origin}/#${bootstrap}`,
    close: shutdown,
    closed: new Promise((resolve) => server.once("close", resolve)),
  });
}
