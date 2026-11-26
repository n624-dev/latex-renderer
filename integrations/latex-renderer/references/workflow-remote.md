# Remote MCP workflow

Start with the tools published by the connected server. If present, call `get_authoring_guide` with the topic you need and `get_renderer_capabilities` to check the environment.

- To continue a saved document, call `get_project`, identify the exact revision, and use `list_project_revision_files` followed by `get_project_revision_file` for the main file, included text, and local styles you need. Continue with each returned `nextOffset`. Use the same revision as the edit's starting point. Read the full file before replacing it. If the client lists the shared draft tools, read the draft and apply one batch at its current version. Replace a draft from an older saved revision only at the user's request and with the expected draft version.
- To start a new document, use `create_source` for small multi-file input or `begin_source_upload`, `upload_source_chunk`, and `finalize_source_upload` for a ZIP. After interrupted upload, call `get_source_upload_status` and resume at the reported byte offset. A ready Source can be reused.
- For work in progress, `render_project_draft` previews a fixed version without adding a saved revision. Use `save_project_draft` when that draft should become part of the history.
- When resuming a document, read `get_project_document_state` for its conditions and adopted revision. A new save does not automatically change the adopted revision.
- Save work in a Project when the user wants to continue revising it. Use `render_project_revision` for that exact saved revision and `create_render` for a one-off Job. Select one entrypoint. Use `retry_render` for an intentional new attempt with the same input.
- If the schema accepts an idempotency key, choose a new key before starting each intentional render. After a lost reply, send the same key and inputs within 24 hours. Reusing a key with changed inputs yields a conflict.
- Use `get_render_status`, `get_render_diagnostics`, and `get_render_artifacts` with the accepted Job ID. For PDF and SVG outputs, inspect each stage. A finished PDF remains available if its SVG stage fails. Use `retry_svg_render` only when the saved PDF can still be used with the same Runtime.
- Use the PDF artifact's page count and `get_render_preview` for each page. If a request is still preparing or temporarily busy, retry the same page and Job. When a preview fails, read its failure reason and use the existing PDF where possible.
- Use protected MCP resources when the client supports them. Offer the authenticated Web result when the client cannot retrieve a large artifact. Report any files or pages you could not access.

Use `get_project_revision_downloads` if available to get the matching saved ZIP and PDF. The Web download links require the owner to sign in. If recording a review, associate each observed check with the exact Job, PDF digest, and conditions version.

To inspect a PDF attached in ChatGPT, use `request_attached_pdf_inspection` when the connected server lists it. Poll `get_attached_pdf_inspection` with the returned upload ID and SHA-256. Pass the physical page number and a rectangle from the displayed page’s top left for a close-up. The original and its inspection results expire one hour after acceptance. Report the pages and observations you actually checked.
