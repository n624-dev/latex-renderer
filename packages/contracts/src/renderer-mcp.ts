// The scopes below are the individual grants used by the renderer.
// The direct connection also accepts its existing legacy "mcp" grant.
export const rendererMcpScopes = [
  "mcp:render",
  "mcp:read",
  "mcp:cancel",
  "mcp:delete",
] as const;
export type RendererMcpScope = (typeof rendererMcpScopes)[number];

export const publicMcpDefaultScopes = [
  "mcp:read",
  "mcp:render",
] as const satisfies readonly RendererMcpScope[];

export function isRendererMcpScope(scope: string): scope is RendererMcpScope {
  return (rendererMcpScopes as readonly string[]).includes(scope);
}

/** An omitted scope starts initial consent with the public defaults. */
export function parsePublicMcpRequestedScopes(
  parameter: string | null,
): RendererMcpScope[] | null {
  if (parameter === null) return [...publicMcpDefaultScopes];
  // OAuth separates scope tokens with spaces. Reject an explicitly empty
  // request, control characters and the direct connection's legacy grant.
  if (!/^[!-~]+(?: +[!-~]+)*$/.test(parameter)) return null;
  const scopes = parameter.split(/ +/);
  return scopes.every(isRendererMcpScope) ? [...new Set(scopes)] : null;
}

/** Permissions must be present in every layer of a public connection. */
export function effectivePublicMcpScopes(
  tokenScopes: readonly string[],
  authorizationScopes: readonly string[],
  localGrantScopes: readonly string[],
  currentUserScopes: readonly string[],
): RendererMcpScope[] {
  return rendererMcpScopes.filter(
    (scope) =>
      tokenScopes.includes(scope) &&
      authorizationScopes.includes(scope) &&
      localGrantScopes.includes(scope) &&
      currentUserScopes.includes(scope),
  );
}

type RendererMcpToolPolicy = {
  // A profile lookup needs an authenticated connection without a specific scope.
  scope: RendererMcpScope | null;
  // Only the key policies describe existing input-bound replay receipts.
  // A state check can help reconcile a lost reply but is not a receipt.
  replay:
    | "read"
    | "required_key"
    | "optional_key"
    | "check_state"
    | "unknown_outcome";
};

export const rendererMcpToolPolicies = {
  adopt_project_revision: {
    scope: "mcp:render",
    replay: "check_state",
  },
  apply_project_changes: {
    scope: "mcp:render",
    replay: "required_key",
  },
  apply_project_revision_cleanup: {
    scope: "mcp:delete",
    replay: "check_state",
  },
  attach_project_revision: {
    scope: "mcp:render",
    replay: "check_state",
  },
  begin_source_upload: {
    scope: "mcp:render",
    replay: "unknown_outcome",
  },
  cancel_render: {
    scope: "mcp:cancel",
    replay: "check_state",
  },
  check_document_requirements: {
    scope: "mcp:read",
    replay: "read",
  },
  check_fonts: {
    scope: "mcp:read",
    replay: "read",
  },
  check_packages: {
    scope: "mcp:read",
    replay: "read",
  },
  compare_render_quality: {
    scope: "mcp:read",
    replay: "read",
  },
  create_project: {
    scope: "mcp:render",
    replay: "unknown_outcome",
  },
  create_render: {
    scope: "mcp:render",
    replay: "optional_key",
  },
  create_source: {
    scope: "mcp:render",
    replay: "unknown_outcome",
  },
  create_source_ref: {
    scope: "mcp:render",
    replay: "unknown_outcome",
  },
  delete_project: {
    scope: "mcp:delete",
    replay: "check_state",
  },
  delete_project_file: {
    scope: "mcp:render",
    replay: "unknown_outcome",
  },
  delete_render: {
    scope: "mcp:delete",
    replay: "check_state",
  },
  delete_source_file: {
    scope: "mcp:render",
    replay: "unknown_outcome",
  },
  finalize_source_upload: {
    scope: "mcp:render",
    replay: "check_state",
  },
  get_attached_pdf_inspection: {
    scope: "mcp:read",
    replay: "check_state",
  },
  get_authoring_guide: {
    scope: "mcp:read",
    replay: "read",
  },
  get_profile: {
    scope: null,
    replay: "read",
  },
  get_project: {
    scope: "mcp:read",
    replay: "read",
  },
  get_project_document_state: {
    scope: "mcp:read",
    replay: "read",
  },
  get_project_draft: {
    scope: "mcp:read",
    replay: "read",
  },
  get_project_draft_file: {
    scope: "mcp:read",
    replay: "read",
  },
  get_project_revision_downloads: {
    scope: "mcp:read",
    replay: "read",
  },
  get_project_revision_file: {
    scope: "mcp:read",
    replay: "read",
  },
  get_project_revision_jobs: {
    scope: "mcp:read",
    replay: "read",
  },
  get_project_storage_usage: {
    scope: "mcp:read",
    replay: "read",
  },
  get_render_artifacts: {
    scope: "mcp:read",
    replay: "read",
  },
  get_render_diagnostics: {
    scope: "mcp:read",
    replay: "read",
  },
  get_render_manifest: {
    scope: "mcp:read",
    replay: "read",
  },
  get_render_preview: {
    scope: "mcp:read",
    replay: "check_state",
  },
  get_render_preview_crop: {
    scope: "mcp:read",
    replay: "check_state",
  },
  get_render_preview_pages: {
    scope: "mcp:read",
    replay: "check_state",
  },
  get_render_preview_sheet: {
    scope: "mcp:read",
    replay: "check_state",
  },
  get_render_quality_report: {
    scope: "mcp:read",
    replay: "read",
  },
  get_render_status: {
    scope: "mcp:read",
    replay: "read",
  },
  get_renderer_capabilities: {
    scope: "mcp:read",
    replay: "read",
  },
  get_source_upload_status: {
    scope: "mcp:render",
    replay: "read",
  },
  import_source_attachment: {
    scope: "mcp:render",
    replay: "required_key",
  },
  list_authoring_profiles: {
    scope: "mcp:read",
    replay: "read",
  },
  list_project_pdf_reviews: {
    scope: "mcp:read",
    replay: "read",
  },
  list_project_revision_files: {
    scope: "mcp:read",
    replay: "read",
  },
  list_projects: {
    scope: "mcp:read",
    replay: "read",
  },
  locate_render_source: {
    scope: "mcp:read",
    replay: "check_state",
  },
  open_project_draft: {
    scope: "mcp:render",
    replay: "check_state",
  },
  plan_project_revision_cleanup: {
    scope: "mcp:read",
    replay: "read",
  },
  probe_document_requirements: {
    scope: "mcp:render",
    replay: "unknown_outcome",
  },
  protect_project_revision: {
    scope: "mcp:render",
    replay: "check_state",
  },
  read_render_log: {
    scope: "mcp:read",
    replay: "read",
  },
  record_project_pdf_review: {
    scope: "mcp:render",
    replay: "unknown_outcome",
  },
  rename_project: {
    scope: "mcp:render",
    replay: "check_state",
  },
  render_project_draft: {
    scope: "mcp:render",
    replay: "check_state",
  },
  render_project_revision: {
    scope: "mcp:render",
    replay: "optional_key",
  },
  request_attached_pdf_inspection: {
    scope: "mcp:render",
    replay: "required_key",
  },
  request_render_quality_report: {
    scope: "mcp:read",
    replay: "check_state",
  },
  retry_render: {
    scope: "mcp:render",
    replay: "optional_key",
  },
  retry_svg_render: {
    scope: "mcp:render",
    replay: "required_key",
  },
  save_project_draft: {
    scope: "mcp:render",
    replay: "check_state",
  },
  search_fonts: {
    scope: "mcp:read",
    replay: "read",
  },
  search_packages: {
    scope: "mcp:read",
    replay: "read",
  },
  update_project_document_conditions: {
    scope: "mcp:render",
    replay: "check_state",
  },
  update_project_file: {
    scope: "mcp:render",
    replay: "unknown_outcome",
  },
  update_source_file: {
    scope: "mcp:render",
    replay: "unknown_outcome",
  },
  upload_source_chunk: {
    scope: "mcp:render",
    replay: "check_state",
  },
  verify_attachment_delivery_origin: {
    scope: "mcp:read",
    replay: "read",
  },
} as const satisfies Record<string, RendererMcpToolPolicy>;

export type RendererMcpTool = keyof typeof rendererMcpToolPolicies;

export const rendererMcpResourceUris = {
  "remote-mcp-guide": "latex-renderer://remote-mcp/guide",
  "rendered-pdf": "latex-renderer://jobs/{jobId}/output.pdf",
  "render-manifest": "latex-renderer://jobs/{jobId}/manifest/{pdfSha256}",
  "compile-log": "latex-renderer://jobs/{jobId}/build.log",
  "render-preview": "latex-renderer://jobs/{jobId}/preview/{page}",
  "render-metadata-artifact": "latex-renderer://jobs/{jobId}/artifact/{name}",
} as const;

export const authoringTopics = [
  "overview",
  "remote",
  "local",
  "layout",
  "quality",
  "diagnostics",
  "security",
  "templates",
  "japanese-math",
  "japanese-report",
  "tikz-figure",
  "accessibility",
  "japanese-tagged",
] as const;
export type AuthoringTopic = (typeof authoringTopics)[number];
