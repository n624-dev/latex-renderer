import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function authoringGuideDefine(repository) {
  const files = JSON.parse(
    await readFile(
      join(repository, "packages/contracts/src/authoring-guide-files.json"),
      "utf8",
    ),
  );
  const topics = await Promise.all(
    Object.entries(files).map(async ([topic, path]) => {
      const body = await readFile(
        join(repository, "integrations/latex-renderer", path),
        "utf8",
      );
      if (Buffer.byteLength(body) > 8192)
        throw new Error("Authoring guide topic exceeds its delivery limit");
      return [topic, body];
    }),
  );
  return {
    __latexRendererAuthoringGuide: JSON.stringify(Object.fromEntries(topics)),
  };
}
