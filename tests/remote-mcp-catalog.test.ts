import { describe, expect, it } from "vitest";
import { assertCompleteWireCatalog } from "../apps/remote-mcp/testing/catalog.js";
const tool = {
  name: "read_status",
  title: "Read status",
  description: "Read server status without changing data.",
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", properties: { ok: { type: "boolean" } } },
  annotations: { readOnlyHint: true, destructiveHint: false },
};
describe("complete wire tool catalog validation", () => {
  it("compiles a single plain read-only tool and catalog subsets", () => {
    const tools = [
      tool,
      { ...tool, name: "read_version" },
      { ...tool, name: "read_limits" },
    ];
    for (const subset of [[tools[0]], tools.slice(0, 2), tools]) {
      const result = assertCompleteWireCatalog({ tools: subset });
      expect(result.toolCount).toBe(subset.length);
      expect(result.schemaCount).toBe(subset.length * 2);
    }
  });
  it("compiles local refs in the serialized schema", () => {
    expect(() =>
      assertCompleteWireCatalog({
        tools: [
          {
            ...tool,
            inputSchema: {
              type: "object",
              properties: { id: { $ref: "#/$defs/id" } },
              required: ["id"],
              $defs: { id: { type: "string" } },
            },
          },
        ],
      }),
    ).not.toThrow();
  });
  it.each([
    { inputSchema: { anyOf: [] } },
    { outputSchema: { type: "string" } },
    {
      inputSchema: {
        type: "object",
        properties: { id: { $ref: "#/$defs/missing" } },
      },
    },
    { inputSchema: { type: "object", properties: {}, required: ["missing"] } },
    { annotations: { readOnlyHint: "true" } },
    { description: "" },
  ])("rejects invalid wire metadata or schemas", (change) => {
    expect(() =>
      assertCompleteWireCatalog({ tools: [{ ...tool, ...change }] }),
    ).toThrow();
  });
  it("rejects duplicate names and a silently incomplete first page", () => {
    expect(() => assertCompleteWireCatalog({ tools: [tool, tool] })).toThrow();
    expect(() =>
      assertCompleteWireCatalog({ tools: [tool], nextCursor: "next" }),
    ).toThrow();
  });
});
