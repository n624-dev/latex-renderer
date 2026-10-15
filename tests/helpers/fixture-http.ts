import type { IncomingMessage } from "node:http";

export async function readFixtureBody(
  request: IncomingMessage,
  maximum = 1024 * 1024,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<unknown>) {
    if (!Buffer.isBuffer(chunk))
      throw new Error("Unexpected fixture body type");
    size += chunk.length;
    if (size > maximum) throw new Error("Unbounded fixture upload");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
