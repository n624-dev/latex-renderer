import {
  AppError,
  credentialUrl,
  trustedCredentialUrl,
} from "@latex-renderer/shared";

export function adminApiBaseUrl(
  configured: string | undefined,
  publicOrigin: string,
  trustedOriginList: string | undefined,
): URL {
  const defaultUrl = credentialUrl(publicOrigin);
  const selected = credentialUrl(configured ?? defaultUrl);
  if (selected.origin === defaultUrl.origin) return selected;
  const trustedOrigins = (trustedOriginList ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
  if (trustedOrigins.length === 0)
    throw new AppError(
      "UNTRUSTED_ADMIN_ORIGIN",
      "A non-default Admin API origin requires LATEX_RENDER_TRUSTED_ADMIN_ORIGINS",
      400,
    );
  return trustedCredentialUrl(selected, trustedOrigins);
}
