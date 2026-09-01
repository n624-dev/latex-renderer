const MAX_JSON_BYTES = 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const API_KEY = /^Bearer lrk_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/;

export const GATEWAY_RESPONSE_HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  "Cloudflare-CDN-Cache-Control": "no-store",
  "CDN-Cache-Control": "no-store",
  Pragma: "no-cache",
  Expires: "0",
});

export async function proxyGatewayJson(input: {
  request: Request;
  upstreamPath: string;
  requestId: string;
  fetchUpstream: (input: URL, init: RequestInit) => Promise<Response>;
  idempotencyRequired?: boolean | undefined;
  /** Whether this route carries a JSON object body. Defaults to true. */
  bodyRequired?: boolean | undefined;
}): Promise<Response> {
  const bodyRequired = input.bodyRequired !== false;
  const authorization = input.request.headers.get("Authorization");
  if (authorization === null || !API_KEY.test(authorization))
    return errorResponse("UNAUTHORIZED", "Bearer API key is required", 401);
  if (
    bodyRequired &&
    mediaType(input.request.headers.get("Content-Type")) !== "application/json"
  )
    return errorResponse(
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type must be application/json",
      415,
    );
  const lengthText = input.request.headers.get("Content-Length");
  let length = 0;
  if (lengthText !== null) {
    if (!/^[0-9]{1,10}$/.test(lengthText))
      return errorResponse(
        "REQUEST_TOO_LARGE",
        "JSON request is too large",
        413,
      );
    length = Number(lengthText);
    if (!Number.isSafeInteger(length) || length > MAX_JSON_BYTES)
      return errorResponse(
        "REQUEST_TOO_LARGE",
        "JSON request is too large",
        413,
      );
    if (bodyRequired && length < 2)
      return errorResponse(
        "REQUEST_TOO_LARGE",
        "JSON request is too small",
        413,
      );
  } else if (bodyRequired) {
    return errorResponse("LENGTH_REQUIRED", "Content-Length is required", 411);
  }

  const idempotencyKey = input.request.headers.get("Idempotency-Key");
  if (
    input.idempotencyRequired === true &&
    (idempotencyKey === null || !IDEMPOTENCY_KEY.test(idempotencyKey))
  )
    return errorResponse(
      "IDEMPOTENCY_KEY_REQUIRED",
      "A valid Idempotency-Key is required",
      400,
    );

  let body: Uint8Array<ArrayBuffer>;
  try {
    body = await readLimited(input.request.body, MAX_JSON_BYTES);
  } catch {
    return errorResponse("REQUEST_TOO_LARGE", "JSON request is too large", 413);
  }
  if (lengthText !== null && body.byteLength !== length)
    return errorResponse(
      "CONTENT_LENGTH_MISMATCH",
      "Content-Length does not match the JSON body",
      400,
    );
  if (!bodyRequired && body.byteLength !== 0) {
    return errorResponse(
      "REQUEST_BODY_NOT_ALLOWED",
      "This endpoint does not accept a request body",
      400,
    );
  }
  if (bodyRequired) {
    try {
      const value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(body),
      ) as unknown;
      if (value === null || typeof value !== "object" || Array.isArray(value))
        throw new Error("JSON root is not an object");
    } catch {
      return errorResponse(
        "INVALID_JSON",
        "Request body must be a JSON object",
        400,
      );
    }
  }

  const headers = new Headers({
    Authorization: authorization,
    "X-Request-Id": input.requestId,
  });
  if (bodyRequired) headers.set("Content-Type", "application/json");
  if (idempotencyKey !== null) headers.set("Idempotency-Key", idempotencyKey);
  const response = await input.fetchUpstream(
    new URL(input.upstreamPath, "http://internal-api.local"),
    {
      method: input.request.method,
      headers,
      ...(body.byteLength === 0 ? {} : { body }),
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (response.status >= 300 && response.status < 400)
    return errorResponse(
      "UPSTREAM_REDIRECT_REJECTED",
      "Private upstream returned a redirect",
      502,
    );
  const responseBody = await readLimited(response.body, MAX_RESPONSE_BYTES);
  if (mediaType(response.headers.get("Content-Type")) !== "application/json")
    return errorResponse(
      "UPSTREAM_RESPONSE_INVALID",
      "Private upstream returned an invalid response",
      502,
    );
  return new Response(responseBody, {
    status: response.status,
    headers: {
      ...GATEWAY_RESPONSE_HEADERS,
      "Content-Type":
        response.headers.get("Content-Type") ?? "application/json",
    },
  });
}

export function gatewayRoute(
  pathname: string,
  method: string,
):
  | {
      upstreamPath: string;
      idempotencyRequired: boolean;
      bodyRequired: boolean;
    }
  | "health"
  | "invalid-job"
  | "method-not-allowed"
  | undefined {
  if (pathname === "/api/v1/health" || pathname === "/health")
    return method === "GET" || method === "HEAD"
      ? "health"
      : "method-not-allowed";
  if (
    pathname === "/api/v1/render-tickets" ||
    pathname === "/v1/render-tickets"
  ) {
    if (method !== "POST") return "method-not-allowed";
    return {
      upstreamPath: "/internal/v1/render-tickets",
      idempotencyRequired: true,
      bodyRequired: true,
    };
  }
  if (
    pathname === "/api/v1/source-tickets" ||
    pathname === "/v1/source-tickets"
  ) {
    if (method !== "POST") return "method-not-allowed";
    return {
      upstreamPath: "/internal/v1/source-tickets",
      idempotencyRequired: true,
      bodyRequired: true,
    };
  }
  const match =
    /^\/(?:api\/v1\/job-tickets|v1\/jobs)\/(job_[a-f0-9]{32})(?:\/ticket)?$/.exec(
      pathname,
    );
  if (match !== null) {
    if (method !== "POST") return "method-not-allowed";
    return {
      upstreamPath: `/internal/v1/jobs/${String(match[1])}/ticket`,
      idempotencyRequired: false,
      bodyRequired: false,
    };
  }
  if (
    pathname.startsWith("/api/v1/job-tickets/") ||
    (pathname.startsWith("/v1/jobs/") && pathname.endsWith("/ticket"))
  )
    return "invalid-job";
  return undefined;
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: GATEWAY_RESPONSE_HEADERS },
  );
}

function mediaType(value: string | null): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

async function readLimited(
  stream: ReadableStream<Uint8Array> | null,
  maximum: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (stream === null) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      throw new Error("Bounded gateway body exceeded its maximum size");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(new ArrayBuffer(length));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
