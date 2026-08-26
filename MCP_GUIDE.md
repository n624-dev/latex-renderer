# MCP guide

The canonical user-facing MCP documentation is [`docs/public/mcp.md`](docs/public/mcp.md). Keep the Remote MCP and Local MCP tool inventories, setup commands, OAuth behavior, Source workflow, and result contracts there so they can be validated against the implementation without a second independent list in this root guide.

## Remote MCP

The preferred cloud connector is:

```text
https://latex-render.n624.jp/mcp
```

Remote MCP uses OAuth Authorization Code + PKCE and owner-scoped Source/Job access. It does not accept a local directory or a long-lived render API key as a tool argument. Current tools are defined in `apps/remote-mcp/src/mcp.ts` and documented in [`docs/public/mcp.md`](docs/public/mcp.md).

Complete PDFs and compile logs are exposed through owner-scoped MCP resources when needed; structured diagnostics, previews, and artifact metadata are available through the corresponding inspection tools. API keys and upload/job tickets are never returned to the AI client.

## Local MCP

The stdio MCP server delegates authenticated operations to the installed client stack and protected CLI credential store. Current tools are registered in `apps/mcp-server/src/server.ts` and documented in [`docs/public/mcp.md`](docs/public/mcp.md).

Use Local MCP when an AI client must work directly with local directories or ZIP files. For multiple selected entrypoints, prepare one Source and create one Job per entrypoint rather than uploading the same project repeatedly.

The signed MCPB build in `client/mcpb` bundles the stdio server for Claude Desktop. Remote MCP remains the normal cloud connector.
