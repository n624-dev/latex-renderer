import { createHash, randomBytes, randomUUID } from "node:crypto";

export * from "./version.js";

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

export function loadResourceLimits(
  environment: Readonly<Record<string, string | undefined>>,
): ResourceLimits {
  const positive = (name: string, fallback: number): number => {
    const value = Number(environment[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error(`${name} must be a positive integer`);
    return value;
  };
  const limits = {
    maxUploadBytes: positive("MAX_UPLOAD_BYTES", DEFAULT_RESOURCE_LIMITS.maxUploadBytes),
    maxExtractedBytes: positive("MAX_EXTRACTED_BYTES", DEFAULT_RESOURCE_LIMITS.maxExtractedBytes),
    maxFileCount: positive("MAX_FILE_COUNT", DEFAULT_RESOURCE_LIMITS.maxFileCount),
    maxZipEntries: positive("MAX_ZIP_ENTRIES", DEFAULT_RESOURCE_LIMITS.maxZipEntries),
  };
  if (limits.maxExtractedBytes < limits.maxUploadBytes)
    throw new Error("MAX_EXTRACTED_BYTES must be at least MAX_UPLOAD_BYTES");
  if (limits.maxZipEntries < limits.maxFileCount)
    throw new Error("MAX_ZIP_ENTRIES must be at least MAX_FILE_COUNT");
  return limits;
}

export type ActorType = "user" | "service_account" | "admin_key" | "local" | "system";

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

export function assertNever(value: never): never {
  throw new AppError("INTERNAL_ERROR", `Unexpected value: ${String(value)}`);
}

export function safeError(error: unknown): { code: string; message: string; status: number } {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, status: error.status };
  }
  return { code: "INTERNAL_ERROR", message: "Internal server error", status: 500 };
}
