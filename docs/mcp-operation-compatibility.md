# LaTeX Renderer MCP operations

LaTeX Renderer has a local stdio server, a direct HTTPS server, and a public HTTPS gateway. The local server also works with files on the client. The two HTTPS entry points share a tool contract, then use the selected Renderer for processing and storage.

| Connection | Authorization | Where artifacts are accessed |
| --- | --- | --- |
| Local stdio | A renderer API key and short-lived Job tickets. Additional document tools need the specific privilege shown below. | Local MCP saves Job artifacts to the explicitly chosen folder. |
| Direct HTTPS | OAuth authorization from the connected Renderer. Tools declare their OAuth scopes. | MCP resources, returned images, and the Renderer’s authenticated download routes. |
| Public HTTPS gateway | OAuth authorization for the gateway and the selected Renderer. The gateway checks both authorization layers and keeps their identifiers separate. | The gateway relays authorized downloads and can issue its own short-lived links. Processing and durable document storage stay with the selected Renderer. |

## Tool coverage

The **Direct/public** column uses the names in the common HTTPS catalog. The public gateway excludes the diagnostic tool for verifying an attachment origin. The **Local** column lists the equivalent operations and any extra scopes. Deployment configuration, authorization, and server version may further limit access.

| Operation | Direct/public | Local |
| --- | --- | --- |
| Guide and engine environment | `get_authoring_guide`, `get_renderer_capabilities`, `list_authoring_profiles`, `check_packages`, `search_packages`, `check_fonts`, `search_fonts`, `check_document_requirements`, `probe_document_requirements` | `get_authoring_guide` reads the bundled guide. Check the connected environment in the Renderer Web UI. |
| Connection identity | `get_profile` | Use the CLI’s saved Renderer connection and API key. |
| Source upload | `create_source`, `begin_source_upload`, `upload_source_chunk`, `get_source_upload_status`, `finalize_source_upload`, `create_source_ref` | `upload_source` packages and uploads a local directory or ZIP. |
| Source editing | `update_source_file`, `delete_source_file` | Edit the chosen local files, then upload them again to create a Source. |
| Attached files | `import_source_attachment`, `request_attached_pdf_inspection`, `get_attached_pdf_inspection`; direct HTTPS can also expose `verify_attachment_delivery_origin` to a dedicated verification account. | Upload a permitted local source directory or ZIP. Client-issued ChatGPT file references are specific to the HTTPS connection. |
| Project metadata and job history | `list_projects`, `get_project`, `create_project`, `rename_project`, `delete_project`, `attach_project_revision`, `get_project_revision_jobs` | Same tools. A Job history row does not grant permission to read that Job when it belongs to another independently issued key. |
| Saved revision files | `list_project_revision_files`, `get_project_revision_file` | Same tools with `render:project:read`. |
| Editing a saved revision directly | `update_project_file`, `delete_project_file` | Open the shared draft, apply the changes, and save the draft to create a new revision. |
| Shared draft reads | `get_project_draft`, `get_project_draft_file` | Same tools with `render:draft:read`. |
| Shared draft writes | `open_project_draft`, `apply_project_changes`, `save_project_draft` | Same tools with `render:draft:write`. A write based on an older draft version returns the current version when available. |
| Trial render of a draft | `render_project_draft` | Compile a local copy with `render_project` or use the shared draft preview in the Renderer Web editor. |
| Job creation and changes | `create_render`, `render_project_revision`, `retry_render`, `retry_svg_render`, `cancel_render`, `delete_render`, `get_render_status` | `create_render_job` and `render_project` create a Job from a named entrypoint. `render_project_revision`, `get_render_status`, `cancel_render`, and `delete_render` use the same tool names. The CLI can retry Jobs. |
| Rendering diagnostics and history | `get_render_diagnostics`, `read_render_log`, `get_render_manifest` | `download_render_artifacts` downloads the error data and log; use the Web UI for details not available in a local download. |
| Artifacts and previews | `get_render_artifacts`, `get_render_preview`, `get_render_preview_pages`, `get_render_preview_crop`, `get_render_preview_sheet`, `locate_render_source`, `get_project_revision_downloads` | `download_render_artifacts` saves outputs and requested full-page PNG previews locally. Use a direct HTTPS connection or the Web UI for specialized preview and revision operations. |
| PDF quality reports | `request_render_quality_report`, `get_render_quality_report`, `compare_render_quality` | Request or read a report with `render:pdf:inspect`. Compare results by checking both reports or using the HTTPS comparison tool. |
| Document conditions and acceptance | `get_project_document_state`, `update_project_document_conditions`, `adopt_project_revision`, `list_project_pdf_reviews`, `record_project_pdf_review` | Use the project’s Web view or the HTTPS tools. |
| Retention and storage | `get_project_storage_usage`, `protect_project_revision`, `plan_project_revision_cleanup`, `apply_project_revision_cleanup` | Use the project’s Web view or the HTTPS tools. |

The Local MCP extensions require a Renderer and Gateway that implement the authoring routes. Older servers continue to accept their existing rendering and download operations. A Project is shared across authorized clients of the same user. An API key’s Job inspection remains bound to that key’s ownership lineage.
