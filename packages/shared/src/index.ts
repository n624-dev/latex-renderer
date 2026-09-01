import { createHash, randomBytes, randomUUID } from "node:crypto";

export * from "./version.js";
export * from "./pagination.js";

export interface ResourceLimits {
  maxUploadBytes: number;
  maxExtractedBytes: number;
  maxFileCount: number;
  maxZipEntries: number;
}

export const DEFAULT_RESOURCE_LIMITS: Readonly<ResourceLimits> = Object.freeze({
  maxUploadBytes: 20 * 1024 * 1024,
  maxExtractedBytes: 100 * 1024 * 1024,
  maxFileCount: 500,
  maxZipEntries: 1_000,
});

export function boundedIntegerEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(fallback) ||
    !Number.isSafeInteger(minimum) ||
    !Number.isSafeInteger(maximum) ||
    minimum > maximum ||
    fallback < minimum ||
    fallback > maximum
  )
    throw new Error(`${name} integer environment schema is invalid`);
  const raw = environment[name];
  if (raw === undefined) return fallback;
  if (!/^(?:0|[1-9][0-9]*)$/.test(raw))
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  return value;
}

export function positiveIntegerEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  return boundedIntegerEnvironment(environment, name, fallback, 1, maximum);
}

export function positiveBytesEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  return positiveIntegerEnvironment(environment, name, fallback, maximum);
}

export function positiveDurationEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  return positiveIntegerEnvironment(environment, name, fallback, maximum);
}

export function validPortEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
): number {
  return boundedIntegerEnvironment(environment, name, fallback, 1, 65_535);
}

export function loadResourceLimits(
  environment: Readonly<Record<string, string | undefined>>,
): ResourceLimits {
  const limits = {
    maxUploadBytes: positiveBytesEnvironment(
      environment,
      "MAX_UPLOAD_BYTES",
      DEFAULT_RESOURCE_LIMITS.maxUploadBytes,
    ),
    maxExtractedBytes: positiveBytesEnvironment(
      environment,
      "MAX_EXTRACTED_BYTES",
      DEFAULT_RESOURCE_LIMITS.maxExtractedBytes,
    ),
    maxFileCount: positiveIntegerEnvironment(
      environment,
      "MAX_FILE_COUNT",
      DEFAULT_RESOURCE_LIMITS.maxFileCount,
    ),
    maxZipEntries: positiveIntegerEnvironment(
      environment,
      "MAX_ZIP_ENTRIES",
      DEFAULT_RESOURCE_LIMITS.maxZipEntries,
    ),
  };
  if (limits.maxExtractedBytes < limits.maxUploadBytes)
    throw new Error("MAX_EXTRACTED_BYTES must be at least MAX_UPLOAD_BYTES");
  if (limits.maxZipEntries < limits.maxFileCount)
    throw new Error("MAX_ZIP_ENTRIES must be at least MAX_FILE_COUNT");
  return limits;
}

export type ActorType =
  "user" | "service_account" | "admin_key" | "local" | "system";

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 500,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseBearer(header: string | undefined): string {
  if (header === undefined || !header.startsWith("Bearer ")) {
    throw new AppError("UNAUTHORIZED", "Bearer credential is required", 401);
  }
  const token = header.slice(7);
  if (token.length === 0 || token.includes(" ")) {
    throw new AppError("UNAUTHORIZED", "Bearer credential is malformed", 401);
  }
  return token;
}

export function credentialUrl(value: string | URL): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(
      "INVALID_CREDENTIAL_URL",
      "Credential target URL is invalid",
      400,
    );
  }
  if (url.username !== "" || url.password !== "")
    throw new AppError(
      "INVALID_CREDENTIAL_URL",
      "Credential target URL must not contain user information",
      400,
    );
  const hostname = url.hostname.toLowerCase();
  const loopback =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    throw new AppError(
      "INSECURE_CREDENTIAL_URL",
      "Credential target URL must use HTTPS (HTTP is allowed only for loopback)",
      400,
    );
  return url;
}

export function trustedCredentialUrl(
  value: string | URL,
  trustedOrigins: readonly string[],
): URL {
  const url = credentialUrl(value);
  const origins = new Set(
    trustedOrigins.map((origin) => credentialUrl(origin).origin),
  );
  if (!origins.has(url.origin))
    throw new AppError(
      "UNTRUSTED_CREDENTIAL_ORIGIN",
      "Credential target origin is not trusted",
      400,
    );
  return url;
}

export function assertNever(value: never): never {
  throw new AppError("INTERNAL_ERROR", `Unexpected value: ${String(value)}`);
}

export function safeError(error: unknown): {
  code: string;
  message: string;
  status: number;
} {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, status: error.status };
  }
  return {
    code: "INTERNAL_ERROR",
    message: "Internal server error",
    status: 500,
  };
}
