import type { Hono } from "hono";
import { AppError } from "@latex-renderer/shared";

export function installBodyLimit(app: Hono, maximum: number): void {
  app.use("*", async (c, next) => {
    c.req.raw = await boundedRequest(c.req.raw, maximum);
    await next();
  });
}

async function boundedRequest(
  request: Request,
  maximum: number,
): Promise<Request> {
  if (request.body === null) return request;
  const declared = request.headers.get("Content-Length");
  if (declared !== null && !/^(?:0|[1-9][0-9]{0,9})$/.test(declared))
    throw new AppError(
      "INVALID_CONTENT_LENGTH",
      "Content-Length is invalid",
      400,
    );
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      throw new AppError("REQUEST_TOO_LARGE", "Request body is too large", 413);
    }
    chunks.push(value);
  }
  if (declared !== null && Number(declared) !== length)
    throw new AppError(
      "CONTENT_LENGTH_MISMATCH",
      "Content-Length does not match the request body",
      400,
    );
  return replayableRequest(request, chunks);
}

function replayableRequest(
  request: Request,
  chunks: readonly Uint8Array[],
): Request {
  return new Request(request, {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}
