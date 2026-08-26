import { AppError } from "@latex-renderer/shared";
import type { z } from "zod";

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError("INVALID_REQUEST", "Request body is invalid", 400);
  return result.data;
}
