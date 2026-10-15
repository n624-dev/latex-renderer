// Machine-readable hints only. Never copy URLs, paths, headers, error messages
// or arbitrary provider codes into deployment logs.
const systemCodes = new Set([
  "EACCES",
  "EPERM",
  "ENOSPC",
  "EDQUOT",
  "ENOENT",
  "EEXIST",
  "EROFS",
  "EMFILE",
  "ENFILE",
  "ENOTDIR",
  "EISDIR",
  "EXDEV",
  "ENOTEMPTY",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ABORT_ERR",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_RES_CONTENT_LENGTH_MISMATCH",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

export function clientSetupFailureDiagnostic(error: unknown): {
  systemCode?: string;
} {
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 5; depth++) {
    if (typeof error !== "object" || error === null || seen.has(error)) break;
    seen.add(error);
    if (
      "code" in error &&
      typeof error.code === "string" &&
      systemCodes.has(error.code)
    )
      return { systemCode: error.code };
    error = "cause" in error ? error.cause : undefined;
  }
  return {};
}
