import { HttpsResponseError } from "./https-json.js";
import {
  rendererRelayDownloadChunkSchema,
  rendererRelayDownloadTargetSchema,
  rendererRelayVersion,
  type RendererRelayDownloadRequest,
  type RendererRelayDownloadTarget,
} from "@latex-renderer/contracts";
import {
  isActiveAuthorization,
  type ConnectionAuthorization,
  type ConnectionStore,
  type ConnectionTransport,
} from "./connections.js";
import { RelayReferences, isRecord } from "./relay-references.js";
import { DispatchFailure } from "./renderer-dispatch.js";

const linkLifetimeMs = 10 * 60_000;
const chunkBytes = 512 * 1024;
const prefix = "/downloads/";

export function createDownloads(options: {
  origin: string;
  references: RelayReferences;
  store: Pick<ConnectionStore, "authorization" | "transport">;
  maxBytes: number;
  capacity: number;
  clock?: () => number;
  pull: (
    auth: ConnectionAuthorization,
    transport: ConnectionTransport,
    request: RendererRelayDownloadRequest,
    signal: AbortSignal,
  ) => Promise<unknown>;
}) {
  const now = options.clock ?? Date.now;
  let active = 0;

  function link(
    auth: ConnectionAuthorization,
    target: RendererRelayDownloadTarget,
  ): string | undefined {
    if (!auth.scopes.includes("mcp:read")) return undefined;
    const ticket = options.references.seal(
      auth,
      `download:${auth.id}`,
      JSON.stringify({ target, expires: now() + linkLifetimeMs }),
    );
    return new URL(`${prefix}${auth.id}/${ticket}`, options.origin).href;
  }

  async function handle(request: Request): Promise<Response | undefined> {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith(prefix)) return undefined;
    if (request.method !== "GET" && request.method !== "HEAD")
      return response(405, { Allow: "GET, HEAD" });
    const [id, ticket, ...extra] = pathname.slice(prefix.length).split("/");
    const auth =
      id && /^authorization_[a-f0-9]{32}$/.test(id)
        ? options.store.authorization(id)
        : undefined;
    if (!auth || !ticket || extra.length || !isActiveAuthorization(auth, now()))
      return response(404);
    let target: RendererRelayDownloadTarget, expires: number;
    try {
      const payload: unknown = JSON.parse(
        options.references.open(auth, `download:${auth.id}`, ticket),
      );
      if (
        !isRecord(payload) ||
        typeof payload.expires !== "number" ||
        !Number.isSafeInteger(payload.expires)
      )
        return response(404);
      expires = payload.expires;
      target = rendererRelayDownloadTargetSchema.parse(payload.target);
    } catch {
      return response(404);
    }
    if (expires <= now()) return response(410);
    if (active >= options.capacity) return response(503);
    active++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active--;
      request.signal.removeEventListener("abort", release);
      clearTimeout(expiryTimer);
    };
    const expiryTimer = setTimeout(
      release,
      Math.max(1, expires - now()),
    ).unref();
    request.signal.addEventListener("abort", release, { once: true });

    async function pull(offset: number, limit: number) {
      if (released || !auth || expires <= now())
        throw new DispatchFailure("connection_revoked");
      const current = options.store.authorization(auth.id),
        transport = current && options.store.transport(current.transportId);
      if (
        !current ||
        !transport ||
        !isActiveAuthorization(current, now()) ||
        transport.disabledAt !== null ||
        transport.instanceId !== current.instanceId ||
        !current.scopes.includes("mcp:read") ||
        current.transportId !== auth.transportId
      )
        throw new DispatchFailure("connection_revoked");
      request.signal.throwIfAborted();
      const result = await options.pull(
        current,
        transport,
        {
          version: rendererRelayVersion,
          instanceId: current.instanceId,
          grant: current.localGrantId,
          target,
          offset,
          limit,
        },
        request.signal,
      );
      if (isRecord(result) && typeof result.relayStatus === "number")
        throw new HttpsResponseError(result.relayStatus);
      const chunk = rendererRelayDownloadChunkSchema.parse(result);
      const expectedType =
        target.kind === "source"
          ? "application/zip"
          : target.path === "result.pdf"
            ? "application/pdf"
            : "image/png";
      if (
        chunk.sha256 !== target.sha256 ||
        chunk.offset !== offset ||
        chunk.mimeType !== expectedType ||
        chunk.size > options.maxBytes
      )
        throw new Error("Renderer download did not match its reference");
      return chunk;
    }

    try {
      const information = await pull(0, 0);
      const etag = `"sha256-${target.sha256}"`;
      const range = request.headers.get("Range"),
        ifRange = request.headers.get("If-Range");
      const useRange = range !== null && (ifRange === null || ifRange === etag);
      const span = useRange
        ? parseRange(range, information.size)
        : { from: 0, to: information.size - 1 };
      if (!span) {
        release();
        return response(416, {
          "Content-Range": `bytes */${information.size}`,
        });
      }
      const suffix =
        information.mimeType === "application/zip"
          ? "zip"
          : information.mimeType === "application/pdf"
            ? "pdf"
            : "png";
      const headers = {
        ...protectedHeaders,
        "Content-Type": information.mimeType,
        "Content-Disposition": `attachment; filename="latex-renderer.${suffix}"`,
        "Content-Length": String(span.to - span.from + 1),
        "Accept-Ranges": "bytes",
        ETag: etag,
        ...(useRange
          ? {
              "Content-Range": `bytes ${span.from}-${span.to}/${information.size}`,
            }
          : {}),
      };
      const status = useRange ? 206 : 200;
      if (request.method === "HEAD" || information.size === 0) {
        release();
        return new Response(null, { status, headers });
      }
      let offset = span.from;
      return new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const length = Math.min(chunkBytes, span.to - offset + 1);
              const chunk = await pull(offset, length);
              const bytes = Buffer.from(chunk.data, "base64");
              if (
                chunk.size !== information.size ||
                bytes.length !== length ||
                bytes.toString("base64") !== chunk.data
              )
                throw new Error("Incomplete renderer download");
              controller.enqueue(bytes);
              offset += bytes.length;
              if (offset > span.to) {
                release();
                controller.close();
              }
            } catch (error) {
              release();
              controller.error(error);
            }
          },
          cancel() {
            release();
          },
        }),
        { status, headers },
      );
    } catch (error) {
      release();
      if (
        error instanceof HttpsResponseError &&
        [401, 403, 404].includes(error.status)
      )
        return response(404);
      if (
        error instanceof DispatchFailure &&
        error.code === "connection_revoked"
      )
        return response(404);
      return response(503);
    }
  }

  return { link, handle };
}

export function parseRange(
  header: string,
  size: number,
): { from: number; to: number } | undefined {
  const match = /^bytes=(\d{0,16})-(\d{0,16})$/.exec(header);
  if (!match || size <= 0) return undefined;
  const [, first, last] = match;
  if (!first) {
    const suffix = Number(last);
    return Number.isSafeInteger(suffix) && suffix > 0
      ? { from: Math.max(0, size - suffix), to: size - 1 }
      : undefined;
  }
  const from = Number(first),
    to = last ? Math.min(Number(last), size - 1) : size - 1;
  return Number.isSafeInteger(from) && Number.isSafeInteger(to) && from <= to
    ? { from, to }
    : undefined;
}

const protectedHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
function response(status: number, headers?: Record<string, string>): Response {
  return new Response(null, {
    status,
    headers: { ...protectedHeaders, ...headers },
  });
}
