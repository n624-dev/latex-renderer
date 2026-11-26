import { lookup } from "node:dns/promises";
import { createWriteStream } from "node:fs";
import { get } from "node:https";
import { BlockList, isIP } from "node:net";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { checkServerIdentity } from "node:tls";
import { AppError } from "@latex-renderer/shared";

const nonPublic = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  nonPublic.addSubnet(network, prefix);
nonPublic.addSubnet("2001:db8::", 32, "ipv6");
nonPublic.addSubnet("2002::", 16, "ipv6");

const globallyRoutedV6 = new BlockList();
globallyRoutedV6.addSubnet("2000::", 3, "ipv6");

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
  // Resolve once, validate the selected destination, then connect to that
  // exact address while verifying TLS against the original DNS name.
  const records = await new Promise<{ address: string; family: number }[]>(
    (resolve, reject) => {
      const stop = () =>
        reject(
          new AppError(
            "ATTACHMENT_UNAVAILABLE",
            "Attachment retrieval timed out",
            504,
          ),
        );
      signal.addEventListener("abort", stop, { once: true });
      void lookup(url.hostname, { all: true })
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", stop));
    },
  );
  const record = records.find(({ address, family }) =>
    family === 4
      ? !nonPublic.check(address)
      : family === 6 &&
        globallyRoutedV6.check(address, "ipv6") &&
        !nonPublic.check(address, "ipv6"),
  );
  if (!record) throw invalidOrigin();
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const request = get(
      {
        hostname: record.address,
        family: record.family,
        servername: url.hostname,
        path: url.pathname + url.search,
        headers: { Host: url.host, "Accept-Encoding": "identity" },
        checkServerIdentity: (_name, certificate) =>
          checkServerIdentity(url.hostname, certificate),
        agent: false,
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
