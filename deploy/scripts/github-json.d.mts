/** Bounded, unauthenticated GET of public project release/tag/attestation metadata. */
export function githubJson(
  url: string,
  userAgent: "latex-renderer-update-helper" | "latex-renderer-update-manager",
): Promise<unknown>;
