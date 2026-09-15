// Transport only: release identity, immutable publication and attestation checks
// remain with each caller. Never retry deployment, downloads or verification.
const attempts = 3;
const attemptMilliseconds = 30_000;
const totalMilliseconds = 95_000;
const maximumDelay = 5_000;
const maximumBytes = 8 * 1024 * 1024;
const transientStatuses = new Set([408, 500, 502, 503, 504]);
const transientCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function transientNetwork(error) {
  for (let depth = 0; error && depth < 4; depth++, error = error.cause) {
    if (error.name === "TimeoutError" || transientCodes.has(error.code))
      return true;
  }
  return false;
}

function responseDelay(response, fallback) {
  let delay = fallback;
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) {
    const parsed = /^\d+$/.test(retryAfter)
      ? Number(retryAfter) * 1000
      : /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
            retryAfter,
          )
        ? Date.parse(retryAfter) - Date.now()
        : NaN;
    // Do not shorten a server-requested wait or guess past a malformed header.
    if (!Number.isFinite(parsed)) return Infinity;
    delay = Math.max(delay, parsed);
  }
  if (response.headers.get("x-ratelimit-remaining") === "0") {
    const reset = response.headers.get("x-ratelimit-reset");
    if (!/^\d+$/.test(reset ?? "")) return Infinity;
    delay = Math.max(delay, Number(reset) * 1000 - Date.now() + 1000);
  } else if (response.status === 429 && retryAfter === null) {
    // GitHub requires at least one minute without a usable rate-limit hint.
    return Infinity;
  }
  return delay;
}

async function boundedJson(response) {
  if (Number(response.headers.get("content-length")) > maximumBytes)
    throw new Error("GitHub JSON response exceeds the 8 MiB limit");
  if (!response.body) throw new Error("GitHub JSON response has no body");
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maximumBytes)
      throw new Error("GitHub JSON response exceeds the 8 MiB limit");
    chunks.push(chunk);
  }
  // Syntax/identity/verification failures are not transport retries.
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function githubJson(url, userAgent) {
  const parsed = new globalThis.URL(url);
  if (
    parsed.origin !== "https://api.github.com" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    !parsed.pathname.startsWith("/repos/n624-dev/latex-renderer/") ||
    !["latex-renderer-update-helper", "latex-renderer-update-manager"].includes(
      userAgent,
    )
  )
    throw new Error("Invalid Updater GitHub metadata request");
  // Elapsed-time admission must not move with NTP/wall-clock adjustments.
  const deadline = globalThis.performance.now() + totalMilliseconds;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const remaining = deadline - globalThis.performance.now();
    if (remaining <= 0)
      throw new Error("GitHub metadata request time budget exhausted");
    let response,
      failure,
      retry,
      delay = 1000 * 2 ** (attempt - 1);
    const signal = globalThis.AbortSignal.timeout(
      Math.min(attemptMilliseconds, Math.ceil(remaining)),
    );
    try {
      response = await globalThis.fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": userAgent,
        },
        signal,
      });
      if (response.ok) return await boundedJson(response);
      failure = `HTTP ${response.status}`;
      const rateLimited =
        response.status === 429 ||
        (response.status === 403 &&
          (response.headers.has("retry-after") ||
            response.headers.get("x-ratelimit-remaining") === "0"));
      retry = transientStatuses.has(response.status) || rateLimited;
      delay = responseDelay(response, delay);
    } catch (error) {
      // Node may report AbortError while consuming a body, even when this
      // attempt's own timeout caused the abort. Unrelated cancellation is final.
      if (
        !transientNetwork(error) &&
        !(signal.aborted && signal.reason?.name === "TimeoutError")
      )
        throw error;
      failure = "transient transport failure";
      retry = true;
    } finally {
      // Discard each failed body before waiting; never append it to a retry.
      await response?.body?.cancel().catch(() => {});
    }
    if (!retry || attempt === attempts)
      throw new Error(
        `GitHub metadata request failed: ${failure} (attempt ${attempt}/${attempts})`,
      );
    if (
      delay > maximumDelay ||
      delay >= deadline - globalThis.performance.now()
    )
      throw new Error(
        `GitHub metadata request deferred: ${failure}; retry later`,
      );
    console.error(
      JSON.stringify({
        event: "update.github_retry",
        attempt,
        nextAttempt: attempt + 1,
        reason: failure,
        delayMs: delay,
      }),
    );
    await new Promise((resolve) => globalThis.setTimeout(resolve, delay));
  }
}
