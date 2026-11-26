import { describe, expect, it } from "vitest";
import {
  effectivePublicMcpScopes,
  parsePublicMcpRequestedScopes,
} from "../packages/contracts/src/renderer-mcp.js";

describe("public MCP scopes", () => {
  it("starts default consent with read and render only", () => {
    expect(parsePublicMcpRequestedScopes(null)).toEqual([
      "mcp:read",
      "mcp:render",
    ]);
  });

  it("retains explicit scopes without adding defaults", () => {
    expect(parsePublicMcpRequestedScopes("mcp:cancel")).toEqual(["mcp:cancel"]);
    expect(parsePublicMcpRequestedScopes("mcp:delete mcp:delete")).toEqual([
      "mcp:delete",
    ]);
  });

  it.each(["", " ", "mcp", "mcp:read mcp", "mcp:admin", "mcp:read\t"])(
    "rejects an invalid explicit scope request %j",
    (requested) => {
      expect(parsePublicMcpRequestedScopes(requested)).toBeNull();
    },
  );

  it("limits effective scopes to the token, authorization, local grant and user", () => {
    expect(
      effectivePublicMcpScopes(
        ["mcp:read", "mcp:render", "mcp:cancel", "mcp:delete"],
        ["mcp:read", "mcp:cancel", "mcp:delete"],
        ["mcp:read", "mcp:delete"],
        ["mcp:read"],
      ),
    ).toEqual(["mcp:read"]);
  });

  it("keeps earlier tokens narrow after consent changes", () => {
    const approved = ["mcp:read", "mcp:delete"];
    expect(
      effectivePublicMcpScopes(["mcp:read"], approved, approved, approved),
    ).toEqual(["mcp:read"]);
    expect(
      effectivePublicMcpScopes(["mcp"], approved, approved, approved),
    ).toEqual([]);
  });
});
