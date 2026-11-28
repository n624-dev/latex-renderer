import { readFile } from "node:fs/promises";
import { text } from "node:stream/consumers";
import yauzl from "yauzl";

/** @param {string} path
 * @returns {Promise<Map<string, string>>}
 */
export async function readZipTextFiles(path) {
  const archive = await yauzl.fromBufferPromise(await readFile(path), {
    lazyEntries: true,
    strictFileNames: true,
  });
  const files = new Map();
  try {
    for await (const entry of archive.eachEntry()) {
      files.set(
        entry.fileName,
        await text(await archive.openReadStreamPromise(entry)),
      );
    }
    return files;
  } finally {
    archive.close();
  }
}
