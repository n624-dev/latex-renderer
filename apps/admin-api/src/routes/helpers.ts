import { AppError } from "@latex-renderer/shared";
import type { Context } from "hono";
import type { z } from "zod";

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AppError("INVALID_REQUEST", "Request body is invalid", 400);
  return result.data;
}

/** Convert only request JSON syntax errors; internal SyntaxErrors remain 500. */
export async function readJson(
  context: Context,
  allowEmpty = false,
): Promise<unknown> {
  const body = await context.req.text();
  if (allowEmpty && body === "") return {};
  try {
    return JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new AppError(
        "INVALID_REQUEST",
        "Request body is invalid JSON",
        400,
      );
    throw error;
  }
}
