import { Hono } from "hono";
import { appendSetCookies, OIDC_STATE_COOKIE } from "@latex-renderer/auth";
import { AppError } from "@latex-renderer/shared";
import { z } from "zod";
import type { AdminDependencies } from "../types.js";
import { parse } from "./helpers.js";

const passwordLoginSchema = z
  .object({
    loginName: z.string().min(1).max(128),
    password: z.string().min(1).max(1024),
  })
  .strict();

export function createAuthenticationRouter(deps: AdminDependencies): Hono {
  const router = new Hono();

  router.get("/config", (c) =>
    c.json({
      ...deps.browserAuth.configuration(),
      publicOrigin: deps.publicOrigin,
    }),
  );

  router.get("/session", async (c) => {
    const session = await deps.browserAuth.establishSession(c.req.raw);
    appendSetCookies(c.res.headers, session.cookies);
    return c.json(sessionResponse(session.principal, session.csrfToken));
  });

  router.post("/password/login", async (c) => {
    if (contentType(c.req.header("Content-Type")) !== "application/json")
      throw new AppError("INVALID_REQUEST", "Login request must be JSON", 400);
    const input = parse(
      passwordLoginSchema,
      await readJson(c.req.raw, 8 * 1024),
    );
    const session = await deps.browserAuth.loginPassword({
      ...input,
      ipAddress: clientAddress(deps, c.req.raw),
      request: c.req.raw,
    });
    appendSetCookies(c.res.headers, session.cookies);
    return c.json(sessionResponse(session.principal, session.csrfToken));
  });

  router.get("/oidc/start", async (c) => {
    const started = await deps.browserAuth.beginOidc(c.req.query("return_to"));
    c.header(
      "Set-Cookie",
      `${OIDC_STATE_COOKIE}=${started.state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300`,
    );
    return c.redirect(started.authorizationUrl, 302);
  });

  router.get("/oidc/callback", async (c) => {
    const providerError = c.req.query("error");
    if (providerError !== undefined)
      throw new AppError(
        "OIDC_LOGIN_REJECTED",
        "OIDC login was not completed",
        401,
      );
    const state = requiredQuery(c.req.query("state"), "OIDC state");
    const code = requiredQuery(c.req.query("code"), "OIDC authorization code");
    const stateCookie = singleCookie(c.req.header("Cookie"), OIDC_STATE_COOKIE);
    if (stateCookie === undefined)
      throw new AppError(
        "OIDC_STATE_INVALID",
        "OIDC login state is invalid or expired",
        401,
      );
    const completed = await deps.browserAuth.finishOidc({
      code,
      state,
      stateCookie,
    });
    deps.browserAuth.logout(c.req.raw);
    appendSetCookies(c.res.headers, [
      `${OIDC_STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      ...completed.cookies,
    ]);
    return c.redirect(completed.returnTo, 303);
  });

  router.post("/logout", (c) => {
    const principal = deps.browserAuth.authenticateSession(c.req.raw);
    if (principal === undefined) deps.browserAuth.requireExactOrigin(c.req.raw);
    else deps.browserAuth.requireMutationCsrf(c.req.raw, principal);
    appendSetCookies(c.res.headers, deps.browserAuth.logout(c.req.raw));
    return c.body(null, 204);
  });

  return router;
}

function sessionResponse(
  principal: Awaited<
    ReturnType<AdminDependencies["browserAuth"]["authenticate"]>
  >,
  csrfToken: string,
) {
  return {
    authenticated: true,
    authMode: principal.authMode,
    csrfToken,
    user: {
      id: principal.user.id,
      email: principal.user.email,
      displayName: principal.user.display_name,
      role: principal.user.role,
      status: principal.user.status,
    },
  };
}

function clientAddress(deps: AdminDependencies, request: Request): string {
  const value =
    deps.deploymentMode === "cloudflare"
      ? request.headers.get("CF-Connecting-IP")
      : request.headers.get("X-Latex-Renderer-Client-IP");
  return value?.trim().slice(0, 200) || "unavailable";
}

function contentType(value: string | undefined): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function requiredQuery(value: string | undefined, label: string): string {
  if (value === undefined || value.length < 1 || value.length > 4096)
    throw new AppError("OIDC_CALLBACK_INVALID", `${label} is invalid`, 400);
  return value;
}

function singleCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (header === undefined) return undefined;
  const values: string[] = [];
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) values.push(rest.join("="));
  }
  return values.length === 1 && values[0] !== "" ? values[0] : undefined;
}

async function readJson(request: Request, maximum: number): Promise<unknown> {
  const declared = request.headers.get("Content-Length");
  if (declared !== null && Number(declared) > maximum)
    throw new AppError("REQUEST_TOO_LARGE", "Request body is too large", 413);
  if (request.body === null)
    throw new AppError("INVALID_REQUEST", "Request body is required", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      throw new AppError("REQUEST_TOO_LARGE", "Request body is too large", 413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(body),
    ) as unknown;
  } catch {
    throw new AppError("INVALID_REQUEST", "Request body is invalid", 400);
  }
}
