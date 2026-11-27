import { AppError } from "@latex-renderer/shared";

export function decodeSourceBase64(value: string): Buffer {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw new AppError(
      "INVALID_BASE64",
      "Binary Source content is invalid",
      400,
    );
  return Buffer.from(value, "base64");
}
