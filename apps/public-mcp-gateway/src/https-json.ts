import { request as httpsRequest } from "node:https";
import { pinPublicHttps } from "@latex-renderer/shared/public-https";

export interface HttpsJsonRequest {
  url: URL;
  trustedOrigin: string;
  signal: AbortSignal;
  maxResponseBytes: number;
  accept?: string;
  protocolVersion?: string;
  body?: { contentType: string; text: string };
  bearer?: string;
}

export type HttpsJsonClient = (options: HttpsJsonRequest) => Promise<unknown>;

export class HttpsResponseError extends Error {
  constructor(readonly status: number) {
    super("The upstream HTTPS endpoint rejected the request");
  }
}

export const requestHttpsJson: HttpsJsonClient = async (options) => {
  const { url, trustedOrigin, signal, maxResponseBytes, body, bearer } =
    options;
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1)
    throw new Error("An upstream response limit is required");
  if (url.port !== "")
    throw new Error("The upstream endpoint must use HTTPS port 443");
  try {
    const endpoint = await pinPublicHttps(url, trustedOrigin, signal);
    if (endpoint === null) throw new Error("Untrusted HTTPS endpoint");
    return await new Promise<unknown>((resolve, reject) => {
      const request = httpsRequest(
        {
          ...endpoint,
          signal,
          method: body === undefined ? "GET" : "POST",
          headers: {
            Host: url.host,
            Accept: options.accept ?? "application/json",
            "Accept-Encoding": "identity",
            ...(options.protocolVersion === undefined
              ? {}
              : {
                  "MCP-Protocol-Version": options.protocolVersion,
                  "Mcp-Method": "tools/call",
                }),
            ...(body === undefined
              ? {}
              : {
                  "Content-Type": body.contentType,
                  "Content-Length": Buffer.byteLength(body.text),
                }),
            ...(bearer === undefined
              ? {}
              : { Authorization: `Bearer ${bearer}` }),
          },
        },
        (response) => {
          const status = response.statusCode ?? 502;
          const type = response.headers["content-type"]
            ?.split(";")[0]
            ?.trim()
            .toLowerCase();
          // Redirects must never carry credentials to a different endpoint.
          if (status < 200 || status > 299) {
            response.destroy();
            reject(new HttpsResponseError(status));
            return;
          }
          if (
            type !== "application/json" ||
            (response.headers["content-encoding"] ?? "identity") !==
              "identity" ||
            Number(response.headers["content-length"] ?? 0) > maxResponseBytes
          ) {
            response.destroy();
            reject(new Error("Invalid upstream JSON response"));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxResponseBytes) {
              reject(new Error("Upstream JSON response exceeded its limit"));
              response.destroy();
              return;
            }
            chunks.push(chunk);
          });
          response.once("error", reject);
          response.once("end", () => {
            try {
              resolve(
                JSON.parse(
                  Buffer.concat(chunks, size).toString("utf8"),
                ) as unknown,
              );
            } catch {
              reject(new Error("Malformed upstream JSON response"));
            }
          });
        },
      );
      request.once("error", reject);
      request.end(body?.text);
    });
  } catch (error) {
    if (error instanceof HttpsResponseError) throw error;
    // Node errors can contain headers or a signed URL. Expose a fixed error.
    // eslint-disable-next-line preserve-caught-error
    throw new Error("Could not read the upstream HTTPS endpoint");
  }
};
