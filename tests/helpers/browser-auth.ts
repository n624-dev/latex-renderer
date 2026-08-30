import type {
  AccessJwtVerifier,
  BrowserAuthenticationService,
} from "@latex-renderer/auth";
import type { RendererDatabase } from "@latex-renderer/database";
import { AppError, newId } from "../../packages/shared/src/index.js";

export function legacyTestBrowserAuth(
  database: RendererDatabase,
  access: Pick<AccessJwtVerifier, "verify">,
): BrowserAuthenticationService {
  let established:
    | {
        user: NonNullable<ReturnType<RendererDatabase["users"]["get"]>>;
        authMode: "cloudflare-access";
      }
    | undefined;
  const authenticate = async (request: Request) => {
    const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
    if (assertion === null)
      throw new AppError(
        "ACCESS_ASSERTION_REQUIRED",
        "Test assertion is required",
        401,
      );
    const identity = await access.verify(assertion);
    const linked = database.raw
      .prepare("SELECT id FROM users WHERE access_subject=?")
      .get(identity.subject) as { id: string } | undefined;
    const user =
      linked === undefined ? undefined : database.users.get(linked.id);
    if (user === undefined || user.status !== "active")
      throw new AppError("ACCOUNT_DISABLED", "Test user is unavailable", 403);
    return { user, authMode: "cloudflare-access" as const };
  };
  return {
    mode: "cloudflare-access",
    publicOrigin: "https://latex.example.com",
    externalProvider: "cloudflare-access",
    externalIssuer: "https://team.cloudflareaccess.com",
    configuration: () => ({
      mode: "cloudflare-access",
      loginPath: "/login/",
      passwordMinimumLength: null,
    }),
    authenticate,
    authenticateSession: (request: Request) =>
      request.headers.get("Cookie")?.includes("test_browser_session=1") === true
        ? established
        : undefined,
    establishSession: async (request: Request) => {
      established = await authenticate(request);
      return {
        principal: established,
        token: "",
        csrfToken: "1",
        cookies: [
          "test_browser_session=1; Path=/; HttpOnly; Secure; SameSite=Lax",
        ],
      };
    },
    requireMutationCsrf: (request: Request) => {
      if (request.headers.get("X-CSRF-Token") !== "1")
        throw new AppError(
          "CSRF_TOKEN_REQUIRED",
          "Test CSRF token is required",
          403,
        );
    },
    requireExactOrigin: () => undefined,
    logout: () => [],
    createExternalIdentity: (input: {
      userId: string;
      subject: string;
      email?: string | undefined;
      preferredUsername?: string | undefined;
      createdAt?: string | undefined;
    }) => {
      const timestamp = input.createdAt ?? new Date().toISOString();
      const row = {
        id: newId("identity"),
        user_id: input.userId,
        provider: "cloudflare-access" as const,
        issuer: "https://team.cloudflareaccess.com",
        subject: input.subject,
        preferred_username: input.preferredUsername ?? null,
        email_at_provider: input.email ?? null,
        linked_at: timestamp,
        last_seen_at: timestamp,
      };
      database.browserAuth.insertIdentity(row);
      return row;
    },
  } as unknown as BrowserAuthenticationService;
}
