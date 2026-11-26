import { createHash, timingSafeEqual } from "node:crypto";
import { readBoundedBody } from "@latex-renderer/shared/bounded-body";
import {
  authorizationLifetimeMs,
  GatewayOAuthTokens,
  type ConsentSession,
  type OAuthAuthorizationRequest,
} from "./oauth-tokens.js";
import { GatewayAgentPairing, pairingLifetimeMs } from "./agent-pairing.js";
import { discoverRendererHttps } from "./renderer-https-discovery.js";
import {
  RendererHttpsOAuth,
  type RendererAuthorizationAttempt,
} from "./renderer-https-oauth.js";
import type { ConnectionAuthorization, ConnectionStore } from "./connections.js";
import {
  HttpsCredentialKeys,
  type HttpsCredentials,
} from "./https-credential-keys.js";
import type { HttpsJsonClient } from "./https-json.js";
import { verifyHttpsRenderer } from "./https-dispatch.js";
import type { RelayReferences } from "./relay-references.js";

interface Pending {
  session: ConsentSession;
  authorization: OAuthAuthorizationRequest;
  expiresAt: number;
  view:
    | { kind: "choose" }
    | { kind: "pair"; code: string }
    | { kind: "https"; attempt: RendererAuthorizationAttempt }
    | {
        kind: "review-https";
        attempt: RendererAuthorizationAttempt;
        credentials: HttpsCredentials;
        identity: Awaited<ReturnType<typeof verifyHttpsRenderer>>;
      };
}

export function createBrowserConsent(options: {
  tokens: GatewayOAuthTokens;
  pairing: GatewayAgentPairing;
  store: ConnectionStore;
  keys: HttpsCredentialKeys;
  references: RelayReferences;
  capacity: number;
  timeoutMs: number;
  maxMetadataBytes: number;
  request?: HttpsJsonClient;
  revokeHttps: (authorizationId: string, mcpUrl: string) => Promise<void>;
  agentOnline: (transportId: string) => boolean;
  deliverAgentRevocations: (transportId: string) => Promise<void>;
}) {
  const { tokens } = options;
  const pending = new Map<string, Pending>();
  const callback = `${tokens.issuer}/oauth/renderer/callback`;

  function prune(): void {
    const now = tokens.clock();
    for (const [id, entry] of pending)
      if (entry.expiresAt <= now) pending.delete(id);
  }

  function get(request: Request, id: string | null): Pending | undefined {
    prune();
    if (!id || !/^[A-Za-z0-9_-]{32}$/.test(id)) return undefined;
    const entry = pending.get(id);
    return entry &&
      equal(
        readCookie(request, `relay_consent_${id}`),
        entry.session.browserSecret,
      )
      ? entry
      : undefined;
  }

  function show(entry: Pending): Response {
    const id = entry.session.id;
    const form = (content: string) =>
      `<form method="post" action="/oauth/authorize"><input type="hidden" name="flow" value="${id}">${content}</form>`;
    const button = (value: string, label: string) =>
      `<button name="action" value="${value}">${label}</button>`;
    if (entry.view.kind === "choose")
      return page(
        "Connect LaTeX Renderer",
        form(
          `<label>Renderer HTTPS URL <input type="url" name="renderer" placeholder="https://renderer.example.com/mcp"></label> ${button("https", "Connect with HTTPS")} ${button("pair", "Use a connection code")} ${button("deny", "Cancel")}`,
        ),
      );
    if (entry.view.kind === "pair") {
      const reviewed = options.pairing.approved(
        entry.session,
        entry.authorization,
      );
      return page(
        "Connect a private Renderer",
        reviewed
          ? `<p>Installation: ${escape(reviewed.instanceId)}<br>Account: ${escape(reviewed.localProfileId)}<br>Permissions: ${escape(reviewed.scopes.join(", "))}</p>${form(`${button("approve", "Confirm connection")} ${button("deny", "Cancel")}`)}`
          : `<p>Enter this code in your Renderer’s ChatGPT connection settings.</p><p class="code">${entry.view.code}</p>${form(`${button("status", "Check approval")} ${button("deny", "Cancel")}`)}`,
      );
    }
    if (entry.view.kind === "review-https") {
      const { attempt, identity, credentials } = entry.view;
      const required = credentials.scopes.filter(
        (scope) => scope !== "mcp:cancel",
      );
      const cancellation = credentials.scopes.includes("mcp:cancel")
        ? '<label><input name="allow_cancel" type="checkbox" value="1"> Allow cancelling render jobs</label>'
        : "";
      return page(
        "Confirm connection",
        `<p>Renderer: ${escape(attempt.connection.issuer)}<br>Account: ${escape(identity.profile)}<br>Permissions: ${escape(required.join(", "))}</p>${form(`${cancellation}${button("approve", "Confirm connection")} ${button("deny", "Cancel")}`)}`,
      );
    }
    return page(
      "Waiting for Renderer authorization",
      form(button("deny", "Cancel")),
    );
  }

  function showConsent(
    _request: Request,
    authorization: OAuthAuthorizationRequest,
  ): Promise<Response> {
    prune();
    if (pending.size >= options.capacity)
      return Promise.resolve(page("Try again later", "", 503));
    const session = tokens.beginConsent(authorization, {
      lifetimeMs: pairingLifetimeMs,
      capacity: options.capacity,
    });
    const entry: Pending = {
      session,
      authorization,
      expiresAt: tokens.clock() + pairingLifetimeMs,
      view: { kind: "choose" },
    };
    pending.set(session.id, entry);
    const response = show(entry);
    response.headers.append(
      "Set-Cookie",
      cookie(
        `relay_consent_${session.id}`,
        session.browserSecret,
        pairingLifetimeMs,
      ),
    );
    return Promise.resolve(response);
  }

  async function submitConsent(
    request: Request,
    fields: URLSearchParams,
  ): Promise<Response> {
    const entry = get(request, fields.get("flow"));
    if (!entry) return page("Connection request expired", "", 400);
    const action = fields.get("action");
    if (action === "deny") {
      pending.delete(entry.session.id);
      return redirect(tokens.denyConsent(entry.session, entry.authorization));
    }
    if (action === "status") return show(entry);
    if (action === "pair" && entry.view.kind === "choose") {
      entry.view = {
        kind: "pair",
        code: options.pairing.start(entry.session, entry.authorization),
      };
      return show(entry);
    }
    if (action === "https" && entry.view.kind === "choose") {
      const renderer = fields.get("renderer");
      if (!renderer) return page("Enter a Renderer HTTPS URL", "", 400);
      const signal = AbortSignal.any([
        request.signal,
        AbortSignal.timeout(options.timeoutMs),
      ]);
      const connection = await discoverRendererHttps(
        renderer,
        { signal, maxResponseBytes: options.maxMetadataBytes },
        options.request,
      );
      const client = new RendererHttpsOAuth(
        connection,
        options.maxMetadataBytes,
        options.request,
        tokens.clock,
      );
      const clientId = await client.registerClient(callback, signal);
      if (get(request, entry.session.id)?.view.kind !== "choose")
        return page("Connection request expired", "", 400);
      const attempt = client.authorize(
        clientId,
        callback,
        entry.authorization.scopes,
      );
      entry.view = { kind: "https", attempt };
      return redirect(attempt.authorizationUrl);
    }
    if (action !== "approve")
      return page("Invalid connection request", "", 400);
    if (entry.view.kind === "pair") {
      const approved = options.pairing.approved(
        entry.session,
        entry.authorization,
      );
      if (!approved) return show(entry);
      if (
        approved.scopes.includes("mcp:delete") &&
        !options.store.hasBaseAccess(
          approved.instanceId,
          approved.localProfileId,
          tokens.clock(),
        )
      )
        return page(
          "Connect with read or render access before approving deletion",
          "",
          403,
        );
      const { location, grant } = tokens.completePairedConsentWithGrant(
        entry.session,
        entry.authorization,
        approved.scopes,
      );
      pending.delete(entry.session.id);
      return managedRedirect(location, grant);
    }
    if (entry.view.kind !== "review-https")
      return page("Connection request expired", "", 400);
    const { attempt, identity, credentials } = entry.view;
    const scopes = credentials.scopes.filter(
      (scope) => scope !== "mcp:cancel" || fields.get("allow_cancel") === "1",
    );
    if (scopes.length === 0)
      return page("Select a permission to continue", "", 400);
    if (
      scopes.includes("mcp:delete") &&
      !options.store.hasBaseAccess(
        identity.instance.id,
        identity.profile,
        tokens.clock(),
      )
    )
      return page(
        "Connect with read or render access before approving deletion",
        "",
        403,
      );
    options.store.putVerifiedInstance(identity.instance);
    const profile = options.store.profileFor(
      identity.instance.id,
      identity.profile,
    );
    const transport = options.store.addTransport(identity.instance.id, {
      kind: "https",
      mcpUrl: attempt.connection.resource,
    });
    const now = tokens.clock();
    const authorization = options.store.createAuthorization(
      {
        profileId: profile.id,
        transportId: transport.id,
        localGrantId: identity.grant,
        scopes,
        expiresAt: now + authorizationLifetimeMs,
      },
      now,
      (id) => options.keys.seal(id, credentials),
    );
    let location: URL;
    try {
      location = tokens.completeConsent(
        entry.session,
        entry.authorization,
        authorization.id,
        scopes,
      );
    } catch (error) {
      options.store.revokeAuthorization(authorization.id, now);
      throw error;
    }
    pending.delete(entry.session.id);
    return managedRedirect(location, authorization);
  }

  function managedRedirect(
    location: URL,
    authorization: ConnectionAuthorization,
  ): Response {
    const proof = options.references.seal(
      authorization,
      "manage-connection",
      authorization.id,
    );
    const response = redirect(location);
    response.headers.append(
      "Set-Cookie",
      cookie(
        `relay_manage_${authorization.id}`,
        proof,
        Math.max(0, authorization.expiresAt - tokens.clock()),
      ),
    );
    return response;
  }

  async function handle(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url);
    if (url.origin !== tokens.issuer) return undefined;
    if (
      url.pathname === "/oauth/renderer/callback" &&
      request.method === "GET"
    ) {
      prune();
      const state = url.searchParams.get("state");
      const entry = [...pending.values()].find(
        (candidate) =>
          candidate.view.kind === "https" &&
          candidate.view.attempt.state === state,
      );
      if (entry?.view.kind !== "https" || !get(request, entry.session.id))
        return page("Connection request expired", "", 400);
      const { attempt } = entry.view;
      const signal = AbortSignal.any([
        request.signal,
        AbortSignal.timeout(options.timeoutMs),
      ]);
      const client = new RendererHttpsOAuth(
        attempt.connection,
        options.maxMetadataBytes,
        options.request,
        tokens.clock,
      );
      try {
        const credentials = await client.exchange(attempt, url, signal);
        const identity = await verifyHttpsRenderer(
          attempt.connection.issuer,
          credentials,
          { signal, maxResponseBytes: options.maxMetadataBytes },
          options.request,
        );
        if (get(request, entry.session.id)?.view.kind !== "https")
          return page("Connection request expired", "", 400);
        entry.view = { kind: "review-https", attempt, credentials, identity };
        return show(entry);
      } catch {
        return page(
          "Renderer connection could not be verified",
          "<p>Check the Renderer version and try connecting again.</p>",
          400,
        );
      }
    }
    if (url.pathname !== "/oauth/connection") return undefined;
    const verified = (id: string) => {
      if (!/^authorization_[a-f0-9]{32}$/.test(id)) return undefined;
      const authorization = options.store.authorization(id);
      if (!authorization || authorization.expiresAt <= tokens.clock())
        return undefined;
      try {
        return options.references.open(
          authorization,
          "manage-connection",
          readCookie(request, `relay_manage_${id}`),
        ) === id
          ? authorization
          : undefined;
      } catch {
        return undefined;
      }
    };
    if (request.method === "GET") {
      const names = [
        ...(request.headers.get("Cookie") ?? "").matchAll(
          /(?:^|;\s*)relay_manage_(authorization_[a-f0-9]{32})=/g,
        ),
      ];
      const entries = names.slice(0, options.capacity).flatMap((match) => {
        const authorization = verified(match[1] ?? "");
        const transport =
          authorization && options.store.transport(authorization.transportId);
        if (!authorization || !transport) return [];
        const profile = options.store.profile(authorization.profileId);
        const label =
          profile?.displayName ||
          (transport.endpoint.kind === "https"
            ? new URL(transport.endpoint.mcpUrl).hostname
            : "Private Renderer");
        const status =
          authorization.revokedAt !== null || transport.disabledAt !== null
            ? "Disconnected"
            : authorization.reauthRequired
              ? "Sign in again"
              : transport.endpoint.kind === "agent"
                ? options.agentOnline(transport.id)
                  ? "Connected"
                  : "Offline"
                : "Authorized";
        return [
          `<form method="post"><p><strong>${escape(label)}</strong><br>${escape(status)} · ${transport.endpoint.kind === "https" ? "HTTPS" : "Agent"}<br>${escape(authorization.scopes.join(", "))}</p><input name="id" type="hidden" value="${authorization.id}">${authorization.revokedAt === null ? '<button name="action" value="disconnect">Disconnect</button>' : '<button name="action" value="forget">Forget connection</button>'}</form>`,
        ];
      });
      return page(
        "ChatGPT connections",
        entries.join("") || "<p>No connections managed by this browser.</p>",
      );
    }
    if (
      request.method !== "POST" ||
      request.headers.get("Origin") !== tokens.issuer
    )
      return page("Invalid connection request", "", 403);
    const fields = new URLSearchParams(
      await readBoundedBody(request, "application/x-www-form-urlencoded", 1024),
    );
    const authorization = verified(fields.get("id") ?? "");
    if (!authorization) return page("This connection is unavailable.", "", 404);
    const action = fields.get("action");
    if (action !== "disconnect" && action !== "forget")
      return page("Invalid connection request", "", 400);
    if (action === "forget" && authorization.revokedAt === null)
      return page("Disconnect the connection first.", "", 409);
    const transport = options.store.transport(authorization.transportId);
    const notify =
      transport?.endpoint.kind === "https" && authorization.revokedAt === null
        ? options.revokeHttps(authorization.id, transport.endpoint.mcpUrl)
        : undefined;
    options.store.disconnect(
      authorization.id,
      tokens.clock(),
      action === "forget",
    );
    if (transport?.endpoint.kind === "agent")
      void options.deliverAgentRevocations(transport.id);
    const downstreamRevoked = await notify?.then(
      () => true,
      () => false,
    );
    const response = page(
      "ChatGPT connection",
      action === "forget"
        ? '<p>Connection forgotten.</p><a href="/oauth/connection">View connections</a>'
        : transport?.endpoint.kind === "agent"
          ? '<p>Disconnected. Renderer will receive the revocation when the agent is online.</p><a href="/oauth/connection">View connections</a>'
          : downstreamRevoked
            ? '<p>Disconnected.</p><a href="/oauth/connection">View connections</a>'
            : '<p>Disconnected at the gateway. Revoke access in Renderer to close the downstream authorization.</p><a href="/oauth/connection">View connections</a>',
    );
    if (action === "forget")
      response.headers.append(
        "Set-Cookie",
        cookie(`relay_manage_${authorization.id}`, "", 0),
      );
    return response;
  }

  return { showConsent, submitConsent, handle };
}

function equal(left: string, right: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(left).digest(),
    createHash("sha256").update(right).digest(),
  );
}

function readCookie(request: Request, name: string): string {
  const item = (request.headers.get("Cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return item?.slice(name.length + 1) ?? "";
}

function cookie(name: string, value: string, lifetimeMs: number): string {
  return `${name}=${value}; Path=/oauth; Max-Age=${Math.floor(lifetimeMs / 1000)}; Secure; HttpOnly; SameSite=Lax`;
}

function redirect(location: string | URL): Response {
  return new Response(null, {
    status: 303,
    headers: {
      Location: String(location),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char,
  );
}

function page(title: string, content: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title><style>body{font:1rem system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem;color-scheme:light dark}form,label{display:grid;gap:.75rem}input,button{font:inherit;padding:.55rem}.code{font:bold 2rem monospace;letter-spacing:.15em}</style><main><h1>${escape(title)}</h1>${content}</main></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "same-origin",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action https:; frame-ancestors 'none'",
      },
    },
  );
}
