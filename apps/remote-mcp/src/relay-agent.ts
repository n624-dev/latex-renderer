import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  rendererRelayAgentDownloadPath,
  rendererRelayAgentOperationPath,
  rendererRelayAgentRevokePath,
  rendererRelayDownloadRequestSchema,
  rendererRelayRequestSchema,
  rendererRelayScopeSchema,
} from "@latex-renderer/contracts";
import { AppError } from "@latex-renderer/shared";
import { readBoundedBody } from "@latex-renderer/shared/bounded-body";
import { z } from "zod";
import type { RemoteMcpAppDependencies } from "./app.js";
import { LocalRelayGrants } from "./relay-grants.js";
import { dispatchRelayOperation } from "./relay-operations.js";

const localApprovalPath = "/oauth/relay";
const claimShape = z
  .object({
    id: z.string().max(128),
    nonce: z.string().max(128),
    clientId: z.string().max(2048),
    scopes: z.array(rendererRelayScopeSchema).min(1).max(4),
    expiresAt: z.number().int(),
  })
  .strict();
const grantPattern = /^relay_grant_[a-f0-9]{32}$/;

export function loadLocalRelay(
  deps: Pick<
    RemoteMcpAppDependencies,
    "database" | "browserAuth" | "mcp" | "publicOrigin" | "relayDownload"
  >,
  instanceId: string | undefined,
  environment: NodeJS.ProcessEnv,
) {
  const path = environment.RENDERER_RELAY_AGENT_GRANTS_DB,
    secretFile = environment.RENDERER_RELAY_AGENT_SECRET_FILE;
  const port = environment.RENDERER_RELAY_AGENT_PORT;
  if (path === undefined && secretFile === undefined && port === undefined)
    return undefined;
  if (
    !instanceId ||
    !path ||
    !secretFile ||
    !port ||
    !/^\d{1,5}$/.test(port) ||
    Number(port) < 1 ||
    Number(port) > 65535
  )
    throw new Error("Renderer relay agent settings are incomplete");
  const secret = readFileSync(secretFile, "utf8").trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret))
    throw new Error("Invalid local relay agent secret");
  const grants = new LocalRelayGrants(path);
  return createLocalRelay(deps, {
    instanceId,
    secret,
    agentOrigin: `http://127.0.0.1:${port}`,
    grants,
  });
}

export function createLocalRelay(
  deps: Pick<
    RemoteMcpAppDependencies,
    "database" | "browserAuth" | "mcp" | "publicOrigin" | "relayDownload"
  >,
  options: {
    instanceId: string;
    secret: string;
    agentOrigin: string;
    grants: LocalRelayGrants;
    relayFetch?: typeof fetch;
  },
) {
  const pending = new Map<
    string,
    z.infer<typeof claimShape> & { userId: string; csrf: string }
  >();
  const relayFetch = options.relayFetch ?? fetch;
  async function agent(
    path: "claim" | "approve" | "revoke",
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const result = await relayFetch(
      new URL(`/pair/${path}`, options.agentOrigin),
      {
        method: "POST",
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.secret}`,
        },
        body: JSON.stringify(body),
      },
    );
    if (!result.ok) {
      await result.body?.cancel();
      throw new AppError(
        "RELAY_AGENT_UNAVAILABLE",
        "The ChatGPT agent is unavailable",
        503,
      );
    }
    return JSON.parse(
      await readBoundedBody(result, "application/json", 8192),
    ) as unknown;
  }

  async function handle(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (
      pathname === rendererRelayAgentOperationPath ||
      pathname === rendererRelayAgentRevokePath ||
      pathname === rendererRelayAgentDownloadPath
    ) {
      if (
        request.method !== "POST" ||
        request.headers.get("Host") !== "127.0.0.1:3104" ||
        !constantEqual(
          request.headers.get("Authorization") ?? "",
          `Bearer ${options.secret}`,
        )
      )
        return new Response(null, { status: 404 });
      if (pathname === rendererRelayAgentRevokePath) {
        const input = z
          .object({ grant: z.string().regex(grantPattern) })
          .strict()
          .safeParse(
            JSON.parse(
              await readBoundedBody(request, "application/json", 1024),
            ) as unknown,
          );
        if (!input.success) return new Response(null, { status: 400 });
        options.grants.revoke(input.data.grant);
        return Response.json({ revoked: true });
      }
      if (pathname === rendererRelayAgentDownloadPath && deps.relayDownload) {
        const requestData: unknown = JSON.parse(
          await readBoundedBody(request, "application/json", 4096),
        );
        const parsed =
          rendererRelayDownloadRequestSchema.safeParse(requestData);
        if (!parsed.success || parsed.data.instanceId !== options.instanceId)
          return new Response(null, { status: 400 });
        const { grant: grantId, target, offset, limit } = parsed.data;
        const grant = options.grants.lookup(grantId, Date.now());
        const user = grant && deps.database.users.get(grant.userId);
        if (
          !grant ||
          user?.status !== "active" ||
          user.security_version !== grant.securityVersion
        )
          return Response.json(
            { error: "local_grant_revoked" },
            { status: 401 },
          );
        return Response.json(
          await deps.relayDownload(grant, target, offset, limit),
        );
      }
      const parsed = rendererRelayRequestSchema.safeParse(
        JSON.parse(
          await readBoundedBody(request, "application/json", 8 * 1024 * 1024),
        ) as unknown,
      );
      if (!parsed.success || parsed.data.instanceId !== options.instanceId)
        return new Response(null, { status: 400 });
      const input = parsed.data,
        grant = options.grants.lookup(input.grant, Date.now());
      const user = grant && deps.database.users.get(grant.userId);
      if (
        !grant ||
        user?.status !== "active" ||
        user.security_version !== grant.securityVersion
      )
        return Response.json({ error: "local_grant_revoked" }, { status: 401 });
      return dispatchRelayOperation({
        handler: deps.mcp,
        publicOrigin: deps.publicOrigin,
        operation: input.operation,
        userId: grant.userId,
        clientId: grant.id,
        scopes: input.scopes.filter((scope) => grant.scopes.includes(scope)),
        signal: request.signal,
      });
    }

    const principal = deps.browserAuth.authenticateSession(request);
    if (!principal)
      return new Response(null, {
        status: 303,
        headers: {
          Location: `/login/?return_to=${encodeURIComponent(localApprovalPath)}`,
          "Cache-Control": "no-store",
        },
      });
    const userId = principal.user.id,
      now = Date.now();
    const csrfCookie =
      (request.headers.get("Cookie") ?? "")
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("relay_csrf="))
        ?.slice(11) ?? "";
    if (request.method === "GET") {
      const csrf = randomBytes(32).toString("base64url");
      const list = options.grants
        .list(userId, now)
        .map((grant) =>
          form(
            csrf,
            `<p>${html(grant.scopes.join(", "))}</p><input type="hidden" name="grant" value="${grant.id}"><button name="action" value="revoke">Disconnect</button>`,
          ),
        )
        .join("");
      const result = response(
        `${form(csrf, `<label>Connection code <input name="code" inputmode="numeric" pattern="[0-9]{8}" maxlength="8" required></label><button name="action" value="claim">Continue</button>`)}${list}`,
      );
      result.headers.append(
        "Set-Cookie",
        `relay_csrf=${csrf}; Path=${localApprovalPath}; Secure; HttpOnly; SameSite=Strict; Max-Age=300`,
      );
      return result;
    }
    if (request.method !== "POST") return new Response(null, { status: 405 });
    deps.browserAuth.requireExactOrigin(request);
    const fields = new URLSearchParams(
      await readBoundedBody(request, "application/x-www-form-urlencoded", 4096),
    );
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(csrfCookie) ||
      !constantEqual(fields.get("csrf") ?? "", csrfCookie)
    )
      return response("This form expired.", 403);
    const action = fields.get("action");
    for (const [id, value] of pending)
      if (value.expiresAt <= now) pending.delete(id);
    if (action === "claim") {
      const code = fields.get("code");
      if (!code || !/^\d{8}$/.test(code) || pending.size >= 100)
        return response("The connection code is invalid or unavailable.", 400);
      const claim = claimShape.safeParse(
        await agent("claim", { code, localProfileId: userId }, request.signal),
      );
      if (!claim.success || claim.data.expiresAt <= now)
        return response("The connection code is invalid or unavailable.", 400);
      pending.set(claim.data.id, { ...claim.data, userId, csrf: csrfCookie });
      const scopes = claim.data.scopes
        .filter((scope) => scope !== "mcp:cancel")
        .map((scope) => `<li>${html(scope)}</li>`)
        .join("");
      const cancellation = claim.data.scopes.includes("mcp:cancel")
        ? '<label><input name="allow_cancel" type="checkbox" value="1"> Allow cancelling render jobs</label>'
        : "";
      return response(
        `<p>Client: ${html(claim.data.clientId)}</p><ul>${scopes}</ul>${form(csrfCookie, `<input type="hidden" name="claim" value="${html(claim.data.id)}">${cancellation}<button name="action" value="approve">Approve access</button>`)}`,
      );
    }
    if (action === "approve") {
      const id = fields.get("claim") ?? "",
        claim = pending.get(id);
      const user = deps.database.users.get(userId);
      if (
        !claim ||
        claim.userId !== userId ||
        !constantEqual(claim.csrf, csrfCookie) ||
        user?.status !== "active"
      )
        return response("The approval expired.", 400);
      const scopes = claim.scopes.filter(
        (scope) => scope !== "mcp:cancel" || fields.get("allow_cancel") === "1",
      );
      if (scopes.length === 0)
        return response("Select a permission to continue.", 400);
      pending.delete(id);
      const grant = options.grants.create(
        userId,
        user.security_version,
        scopes,
        now,
      );
      try {
        if (
          (await agent(
            "approve",
            {
              id,
              nonce: claim.nonce,
              localProfileId: userId,
              localGrantId: grant,
              scopes,
            },
            request.signal,
          )) !== true
        )
          throw new Error("Gateway rejected the approval");
      } catch (error) {
        options.grants.revoke(grant, userId);
        throw error;
      }
      return response(
        "Access approved. Return to the browser where you started the connection and confirm it.",
      );
    }
    if (action === "revoke") {
      const grant = fields.get("grant") ?? "";
      if (!grantPattern.test(grant) || !options.grants.revoke(grant, userId))
        return response("Connection not found.", 404);
      await agent("revoke", { grant }, request.signal).catch(() => undefined);
      return new Response(null, {
        status: 303,
        headers: { Location: localApprovalPath, "Cache-Control": "no-store" },
      });
    }
    return response("Invalid request.", 400);
  }
  return { handle, close: () => options.grants.close() };
}

function constantEqual(left: string, right: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(left).digest(),
    createHash("sha256").update(right).digest(),
  );
}

function html(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char,
  );
}

function form(csrf: string, content: string): string {
  return `<form method="post" action="${localApprovalPath}"><input type="hidden" name="csrf" value="${csrf}">${content}</form>`;
}

function response(content: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ChatGPT connections</title><main><h1>ChatGPT connections</h1>${content}</main></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "same-origin",
        "Content-Security-Policy":
          "default-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
      },
    },
  );
}
