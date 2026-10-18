import { AjvJsonSchemaValidator } from "@modelcontextprotocol/server/validators/ajv";
export { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/server";

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Test-only: compile the schemas actually serialized by the SDK, not the source
// Zod definitions. No runtime schema cache or new dependency is added.
export function assertCompleteWireCatalog(result: unknown): {
  toolCount: number;
  schemaCount: number;
  bytes: number;
} {
  if (
    !object(result) ||
    !Array.isArray(result.tools) ||
    result.tools.length === 0 ||
    result.nextCursor !== undefined
  )
    throw new Error("Expected one complete nonempty tools/list page");
  const validator = new AjvJsonSchemaValidator(),
    names = new Set<string>();
  let schemaCount = 0;
  for (const value of result.tools) {
    if (
      !object(value) ||
      typeof value.name !== "string" ||
      !/^[A-Za-z0-9_.-]{1,128}$/.test(value.name) ||
      names.has(value.name) ||
      typeof value.description !== "string" ||
      value.description.trim().length === 0 ||
      (value.title !== undefined &&
        (typeof value.title !== "string" || value.title.trim().length === 0))
    )
      throw new Error("Invalid or duplicate tool metadata");
    names.add(value.name);
    if (value.annotations !== undefined) {
      if (!object(value.annotations))
        throw new Error("Tool annotations must be an object");
      for (const key of [
        "readOnlyHint",
        "destructiveHint",
        "idempotentHint",
        "openWorldHint",
      ])
        if (
          value.annotations[key] !== undefined &&
          typeof value.annotations[key] !== "boolean"
        )
          throw new Error("Invalid tool annotation type");
    }
    for (const key of ["inputSchema", "outputSchema"]) {
      if (key === "outputSchema" && value[key] === undefined) continue;
      const schema = value[key];
      if (!object(schema) || schema.type !== "object")
        throw new Error("Tool schema must have an object root");
      if (
        schema.required !== undefined &&
        (!Array.isArray(schema.required) ||
          schema.required.some(
            (name: unknown) =>
              typeof name !== "string" ||
              !object(schema.properties) ||
              !Object.hasOwn(schema.properties, name),
          ))
      )
        throw new Error("Tool required properties are inconsistent");
      // Includes unresolved $ref and unsupported dialect failures. Validation
      // callbacks are compiled, but tool actions are never invoked.
      validator.getValidator(schema);
      schemaCount++;
    }
  }
  return {
    toolCount: names.size,
    schemaCount,
    bytes: Buffer.byteLength(JSON.stringify(result)),
  };
}
