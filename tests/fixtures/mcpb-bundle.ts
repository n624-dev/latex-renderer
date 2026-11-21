import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";

export async function writeMcpbZipFixture(
  destination: string,
  manifest: Buffer,
  options: { serverMode?: number; serverPath?: string } = {},
) {
  const zip = new yazl.ZipFile();
  const writing = pipeline(zip.outputStream, createWriteStream(destination));
  zip.addBuffer(manifest, "manifest.json", { mode: 0o100644 });
  zip.addBuffer(
    Buffer.from("process.exit(0);\n"),
    options.serverPath ?? "server/index.cjs",
    { mode: options.serverMode ?? 0o100755 },
  );
  zip.end();
  await writing;
}
