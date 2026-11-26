export async function readBoundedBody(
  request: Pick<Request, "headers" | "body">,
  contentType: string,
  limit: number,
): Promise<string> {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
      contentType ||
    Number(request.headers.get("content-length") ?? 0) > limit ||
    !request.body ||
    !Number.isSafeInteger(limit) ||
    limit < 1
  )
    throw new Error("Invalid request body");
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("Request body exceeded its limit");
      }
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, size),
    );
  } finally {
    reader.releaseLock();
  }
}
