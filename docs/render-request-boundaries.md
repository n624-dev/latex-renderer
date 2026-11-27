# Render requests and shared storage

The HTTP and MCP entry points authenticate the caller before invoking the renderer. The public MCP gateway forwards operations to the connected instance. That instance owns its Jobs, Drafts, Sources, and storage limits.

| Entry point | Authorization | Work reserved at admission |
| --- | --- | --- |
| API key with a new ZIP | The Internal API authenticates the render key and checks its service account | Input bytes and the configured output reservation |
| API key with an uploaded Source or saved revision | The Internal API checks the caller's access to the Source or revision | Output reservation. The Source is already included in storage usage |
| Signed-in Web or administrator rendering | The application checks the session, CSRF token and, when relevant, the selected render identity | Input and output for a new ZIP, or output for an existing Source |
| Remote MCP rendering | The adapter checks the OAuth scope and the connected user's ownership | Output reservation after the Source is ready |
| Shared Draft preview | The application or MCP adapter checks access to the Project | Output reservation after the requested Draft version is pinned |
| Whole Job retry | The application or MCP adapter checks the existing Job and retained Source | Output reservation using the original Source |
| SVG-only retry | The adapter checks ownership and the saved PDF's Runtime | Remaining output capacity for the existing Job |

The database checks maintenance mode, queue limits, and the owner's remaining storage while admitting a Job. The final checks run in the transaction that reserves storage or queues the work. Reading an idempotent result from a previous request can take a different path from reserving new work. Source uploads use the same storage accounting and may continue in `reject-new-jobs` mode.

The Web and Remote MCP services use the same Draft operations in `packages/renderer-core`. Draft changes check the expected version again when publishing the updated file reference. Files are written and synchronized before ready Sources or new saved revisions can reference them. Source references require a ready Source owned by the selected user and expire within 15 minutes. A reference expires earlier if the Source's remaining retention is shorter.

The environment inventory belongs to the active Runtime. Web and Remote MCP use the same reader for package and font searches and engine verification. In each service, an inventory cache entry is tied to the Runtime identity and file metadata. OAuth registration, code exchange, refresh replay, and consent remain in the MCP authentication layer. A Web session uses its own authorization throughout.
