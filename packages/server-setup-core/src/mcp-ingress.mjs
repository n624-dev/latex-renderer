// Rules use regex syntax shared by cloudflared and Nginx. Keep the denial
// before the broader MCP route. The local agent uses the loopback origin.
export const mcpIngress = Object.freeze([
  {
    pattern: "^/mcp/relay/local-(operation|revoke|download)(/|$)",
    route: "deny",
  },
  {
    pattern:
      "^/\\.well-known/oauth-(authorization-server|protected-resource)(/.*)?$",
    route: "mcp",
  },
  { pattern: "^/(oauth|mcp)(/|$)", route: "mcp" },
]);
