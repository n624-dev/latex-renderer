import { createWriteStream } from "node:fs";
import { get } from "node:https";
import { isIP } from "node:net";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AppError } from "@latex-renderer/shared";
import { pinPublicHttps } from "@latex-renderer/shared/public-https";

export function attachmentOrigins(
  value: string | undefined,
): ReadonlySet<string> {
  const values =
    value
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? [];
  return new Set(
    values.map((origin) => {
      const url = new URL(origin);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        url.port ||
        isIP(url.hostname.replace(/^\[|\]$/g, ""))
      )
        throw new Error(
          "Remote attachment origins must be exact HTTPS DNS origins",
        );
      return url.origin;
    }),
  );
}

export function attachmentOriginForVerification(value: string): string {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) throw invalidOrigin();
    if (!attachmentOrigins(url.origin).has(url.origin)) throw invalidOrigin();
    return url.origin;
  } catch {
    throw invalidOrigin();
  }
}

function invalidOrigin() {
  return new AppError(
    "ATTACHMENT_ORIGIN_INVALID",
    "Attachment source is unavailable for this connection",
    400,
  );
}

export async function downloadAttachment(
  source: string,
  origins: ReadonlySet<string>,
  destination: string,
  maxBytes: number,
  format: "ZIP" | "PDF" = "ZIP",
): Promise<void> {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw invalidOrigin();
  }
  if (
    !origins.has(url.origin) ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash
  )
    throw invalidOrigin();

  const signal = AbortSignal.timeout(30_000);
  const connection = await pinPublicHttps(url, url.origin, signal).catch(
    (error: unknown) => {
      if (signal.aborted)
        throw new AppError(
          "ATTACHMENT_UNAVAILABLE",
          "Attachment retrieval timed out",
          504,
        );
      throw error;
    },
  );
  if (!connection) throw invalidOrigin();
  await new Promise<void>((resolve, reject) => {
    const request = get(
      {
        ...connection,
        headers: { Host: url.host, "Accept-Encoding": "identity" },
        signal,
      },
      (response) => {
        const status = response.statusCode;
        if (
          status !== 200 ||
          ![undefined, "identity"].includes(
            response.headers["content-encoding"],
          )
        ) {
          response.destroy();
          reject(
            new AppError(
              status === 401 ||
                status === 403 ||
                status === 404 ||
                status === 410
                ? "ATTACHMENT_EXPIRED"
                : "ATTACHMENT_UNAVAILABLE",
              "Could not retrieve this attachment. Attach the file again or upload it directly.",
              409,
            ),
          );
          return;
        }
        const declared = Number(response.headers["content-length"] ?? 0);
        if (declared > maxBytes) {
          response.destroy();
          reject(
            new AppError(
              format === "ZIP" ? "SOURCE_ARCHIVE_SIZE" : "PDF_UPLOAD_SIZE",
              `Attachment exceeds the ${format} upload limit`,
              413,
            ),
          );
          return;
        }
        let received = 0;
        const limit = new Transform({
          transform(chunk: Buffer, _, callback) {
            received += chunk.length;
            if (received > maxBytes)
              callback(
                new AppError(
                  format === "ZIP" ? "SOURCE_ARCHIVE_SIZE" : "PDF_UPLOAD_SIZE",
                  `Attachment exceeds the ${format} upload limit`,
                  413,
                ),
              );
            else callback(null, chunk);
          },
        });
        void pipeline(
          response,
          limit,
          createWriteStream(destination, { flags: "wx", mode: 0o660 }),
          { signal },
        ).then(resolve, reject);
      },
    );
    request.once("error", reject);
  });
}
