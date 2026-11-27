import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { authoringTopics, type AuthoringTopic } from "./renderer-mcp.js";
import guideFiles from "./authoring-guide-files.json" with { type: "json" };

declare const __latexRendererAuthoringGuide: Readonly<Record<AuthoringTopic, string>> | undefined;

export { authoringTopics };
export type { AuthoringTopic };

async function loadGuide() {
  const embedded = typeof __latexRendererAuthoringGuide === "undefined"
    ? undefined
    : __latexRendererAuthoringGuide;
  const topics = await Promise.all(
    authoringTopics.map(async (topic) => {
      const body = embedded?.[topic] ?? await readFile(
        new URL(`../../../integrations/latex-renderer/${guideFiles[topic]}`, import.meta.url),
        "utf8",
      );
      if (Buffer.byteLength(body, "utf8") > 8192)
        throw new Error("Authoring guide topic exceeds its delivery limit");
      return [topic, body] as const;
    }),
  );
  const version = createHash("sha256")
    .update(JSON.stringify(topics))
    .digest("hex");
  return { version, topics: new Map(topics) };
}

let guide: ReturnType<typeof loadGuide> | undefined;

export async function getAuthoringGuide(topic: AuthoringTopic) {
  const current = await (guide ??= loadGuide().catch((error: unknown) => {
    guide = undefined;
    throw error;
  }));
  const body = current.topics.get(topic);
  if (body === undefined)
    throw new Error("Authoring guide topic does not exist");
  return { version: current.version, topic, body, topics: authoringTopics };
}
