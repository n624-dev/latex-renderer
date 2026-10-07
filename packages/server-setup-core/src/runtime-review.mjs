import { isAbsolute, normalize } from "node:path";
import { profileRecord, profileText } from "./profile-shape.mjs";
import { parseEnvironmentFile } from "./production-profile.mjs";
import {
  importServerSetupDeploymentReview,
  validateServerSetupDeploymentReview,
  serverSetupDeploymentReviewEnvironment,
} from "./deployment-review.mjs";

// Existing API/worker defaults, in bytes (not a disk quota). Runtime parity is
// exercised against the actual worker/shared loaders, not a second fixture.
export const SERVER_RUNTIME_LIMITS = Object.freeze({
  maxUploadBytes: Object.freeze(["MAX_UPLOAD_BYTES", 20 * 1024 ** 2]),
  maxExtractedBytes: Object.freeze(["MAX_EXTRACTED_BYTES", 100 * 1024 ** 2]),
  maxFileCount: Object.freeze(["MAX_FILE_COUNT", 500]),
  maxZipEntries: Object.freeze(["MAX_ZIP_ENTRIES", 1000]),
  maxOutputBytes: Object.freeze(["MAX_OUTPUT_BYTES", 200 * 1024 ** 2]),
  maxOutputFileCount: Object.freeze(["MAX_OUTPUT_FILE_COUNT", 2000]),
  maxOutputDirectoryCount: Object.freeze(["MAX_OUTPUT_DIRECTORY_COUNT", 200]),
  maxLogBytes: Object.freeze(["MAX_LOG_BYTES", 10 * 1024 ** 2]),
  maxSvgObjects: Object.freeze(["MAX_SVG_OBJECTS", 200]),
  maxSvgBytes: Object.freeze(["MAX_SVG_BYTES", 10 * 1024 ** 2]),
  maxSvgTotalBytes: Object.freeze(["MAX_SVG_TOTAL_BYTES", 100 * 1024 ** 2]),
  svgConversionTimeoutSeconds: Object.freeze([
    "SVG_CONVERSION_TIMEOUT_SECONDS",
    120,
    86400,
  ]),
  maxQueueLength: Object.freeze(["MAX_QUEUE_LENGTH", 100]),
  maxUserStorageBytes: Object.freeze(["MAX_USER_STORAGE_BYTES", 1024 ** 3]),
  minFreeStorageBytes: Object.freeze(["MIN_FREE_STORAGE_BYTES", 5 * 1024 ** 3]),
  jobTimeoutSeconds: Object.freeze([
    "RENDERER_JOB_TIMEOUT_SECONDS",
    420,
    86400,
  ]),
});

function path(value, label) {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    value === "/" ||
    !isAbsolute(value) ||
    normalize(value) !== value ||
    !/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(value)
  )
    throw new Error(`${label} must be a canonical absolute path`);
  return value;
}

export function validateServerRuntimeReview(input) {
  const model = profileRecord(input, "runtime review", [
    "databasePath",
    "storageRoot",
    "rendererImage",
    "limits",
  ]);
  const databasePath = path(
    profileText(model, "databasePath", "databasePath"),
    "databasePath",
  );
  const storageRoot = path(
    profileText(model, "storageRoot", "storageRoot"),
    "storageRoot",
  );
  const rendererImage = profileText(model, "rendererImage", "rendererImage");
  if (
    !/^sha256:[a-f0-9]{64}$/.test(rendererImage) &&
    !/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(rendererImage)
  )
    throw new Error(
      "rendererImage must be an immutable image ID or registry digest",
    );
  const source = profileRecord(
    model.limits,
    "runtime limits",
    Object.keys(SERVER_RUNTIME_LIMITS),
  );
  const limits = {};
  for (const [name, [, , maximum = Number.MAX_SAFE_INTEGER]] of Object.entries(
    SERVER_RUNTIME_LIMITS,
  )) {
    const value = source[name];
    if (
      !Object.hasOwn(source, name) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > maximum
    )
      throw new Error(
        `Runtime limit ${name} must be a positive bounded integer`,
      );
    limits[name] = value;
  }
  if (limits.maxExtractedBytes < limits.maxUploadBytes)
    throw new Error("MAX_EXTRACTED_BYTES must be at least MAX_UPLOAD_BYTES");
  if (limits.maxZipEntries < limits.maxFileCount)
    throw new Error("MAX_ZIP_ENTRIES must be at least MAX_FILE_COUNT");
  return Object.freeze({
    databasePath,
    storageRoot,
    rendererImage,
    limits: Object.freeze(limits),
  });
}

export function importServerRuntimeReview(contents) {
  parseEnvironmentFile(contents); // also rejects duplicates/control bytes in excluded fields
  const values = new Map(
    contents
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
  const limits = {};
  for (const [name, [key, fallback]] of Object.entries(SERVER_RUNTIME_LIMITS)) {
    const raw = values.get(key);
    if (raw !== undefined && !/^(?:0|[1-9][0-9]*)$/.test(raw))
      throw new Error(`Runtime limit ${name} must be an integer`);
    limits[name] = raw === undefined ? fallback : Number(raw);
  }
  return validateServerRuntimeReview({
    databasePath: values.get("DATABASE_PATH"),
    storageRoot: values.get("STORAGE_ROOT"),
    rendererImage: values.get("RENDERER_IMAGE"),
    limits,
  });
}

export function serverRuntimeReviewEnvironment(input) {
  const model = validateServerRuntimeReview(input);
  const values = new Map([
    ["DATABASE_PATH", model.databasePath],
    ["STORAGE_ROOT", model.storageRoot],
    ["RENDERER_IMAGE", model.rendererImage],
  ]);
  for (const [name, [key]] of Object.entries(SERVER_RUNTIME_LIMITS))
    values.set(key, String(model.limits[name]));
  return values;
}

// Format 3 stays compatible. Format 4 is its explicit, secret-free extension;
// importing never copies secret references, mutable-image overrides or policy.
export function validateServerSetupReview(input) {
  const model = profileRecord(input, "server setup review", [
    "format",
    "deployment",
    "runtime",
  ]);
  if (model.format !== 4)
    throw new Error("Server setup review requires format 4");
  return Object.freeze({
    format: 4,
    deployment: validateServerSetupDeploymentReview(model.deployment),
    runtime: validateServerRuntimeReview(model.runtime),
  });
}
export function importServerSetupReview(contents) {
  return validateServerSetupReview({
    format: 4,
    deployment: importServerSetupDeploymentReview(contents),
    runtime: importServerRuntimeReview(contents),
  });
}
export function serverSetupReviewEnvironment(input) {
  const model = validateServerSetupReview(input);
  return new Map([
    ...serverSetupDeploymentReviewEnvironment(model.deployment),
    ...serverRuntimeReviewEnvironment(model.runtime),
  ]);
}
