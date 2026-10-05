import { randomBytes, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";
import { validateServerSetupReview } from "./runtime-review.mjs";
import { reviewServerSetupReadiness } from "./setup-readiness.mjs";

export class ServerSetupSessionError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const sameToken = (actual, expected) =>
  typeof actual === "string" &&
  typeof expected === "string" &&
  /^[A-Za-z0-9_-]{43}$/.test(actual) &&
  actual.length === expected.length &&
  timingSafeEqual(Buffer.from(actual), Buffer.from(expected));

/** A single CUI/Web state machine, not a second deployment implementation.
 * Host operations are trusted adapters and never serialized to the frontend.
 * A review token binds the exact validated candidate and the host's stale-base
 * guard. Nothing is applied by editing a draft or requesting status.
 */
export function createServerSetupSession(host, options = {}) {
  const clock = options.clock ?? (() => performance.now());
  const lifetimeMs = options.lifetimeMs ?? 30 * 60_000;
  if (
    !Number.isSafeInteger(lifetimeMs) ||
    lifetimeMs < 1000 ||
    lifetimeMs > 2 * 60 * 60_000
  )
    throw new ServerSetupSessionError("INVALID_LIFETIME");
  let expires = clock() + lifetimeMs,
    phase = "editing",
    busy = false;
  let installed = null,
    pending = null,
    confirmation = null,
    reviews = 0;
  function alive() {
    if (clock() >= expires && !busy) {
      phase = "closed";
      pending = confirmation = installed = null;
    }
    if (phase === "closed") throw new ServerSetupSessionError("SESSION_CLOSED");
  }
  async function exclusive(operation) {
    alive();
    if (busy) throw new ServerSetupSessionError("SESSION_BUSY");
    if (phase === "complete")
      throw new ServerSetupSessionError("SESSION_COMPLETE");
    busy = true;
    try {
      return await operation();
    } finally {
      busy = false;
    }
  }
  const session = {
    async status() {
      alive();
      if (busy) throw new ServerSetupSessionError("SESSION_BUSY");
      // Load once, and let preview/apply recheck the current host. The installed
      // model contains only non-secret fields admitted by format 4.
      if (installed === null) {
        await exclusive(async () => {
          try {
            installed = validateServerSetupReview(await host.current());
          } catch {
            throw new ServerSetupSessionError("HOST_UNAVAILABLE");
          }
        });
      }
      return { phase, review: installed, scope: "existing-prepared-host" };
    },
    async preview(input) {
      return exclusive(async () => {
        pending = confirmation = null;
        phase = "editing";
        if (++reviews > 128) throw new ServerSetupSessionError("REVIEW_LIMIT");
        let candidate;
        try {
          candidate = validateServerSetupReview(input);
        } catch {
          throw new ServerSetupSessionError("INVALID_REVIEW");
        }
        try {
          pending = await host.preview(candidate);
        } catch {
          throw new ServerSetupSessionError("HOST_REVIEW_FAILED");
        }
        confirmation = randomBytes(32).toString("base64url");
        phase = "reviewed";
        return {
          review: candidate,
          readiness: reviewServerSetupReadiness(candidate),
          confirmation,
        };
      });
    },
    async apply(token) {
      return exclusive(async () => {
        if (phase !== "reviewed" || !sameToken(token, confirmation))
          throw new ServerSetupSessionError("REVIEW_CONFIRMATION_REQUIRED");
        const envelope = pending;
        pending = confirmation = null;
        phase = "applying";
        try {
          await host.apply(envelope);
          phase = "complete";
          return { phase: "complete" };
        } catch {
          phase = "failed";
          // Do not retain a reusable token after a partial/failed transaction.
          // The durable host journal, not this ephemeral session, owns recovery.
          throw new ServerSetupSessionError(
            "APPLY_FAILED_RECOVERY_MAY_BE_REQUIRED",
          );
        }
      });
    },
    close() {
      if (busy) throw new ServerSetupSessionError("SESSION_BUSY");
      phase = "closed";
      expires = 0;
      installed = pending = confirmation = null;
    },
  };
  return Object.freeze(session);
}
