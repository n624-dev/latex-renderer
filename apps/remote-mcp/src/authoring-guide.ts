import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { AppError } from "@latex-renderer/shared";

const guideRoot = new URL(
  "../../../integrations/latex-renderer/",
  import.meta.url,
);
const guideFiles = {
  overview: "SKILL.md",
  remote: "references/workflow-remote.md",
  local: "references/workflow.md",
  layout: "references/latex-rules.md",
  quality: "references/quality-review.md",
  diagnostics: "references/error-handling.md",
  security: "references/security.md",
  templates: "references/templates.md",
  "japanese-math": "assets/japanese-math.tex",
  "japanese-report": "assets/japanese-report.tex",
  "tikz-figure": "assets/tikz-figure.tex",
  accessibility: "references/accessibility.md",
  "japanese-tagged": "assets/japanese-tagged.tex",
} as const;

export type AuthoringTopic = keyof typeof guideFiles;
export const authoringTopics = Object.keys(guideFiles) as AuthoringTopic[];

async function loadGuide() {
  const topics = await Promise.all(
    authoringTopics.map(async (topic) => {
      const body = await readFile(
        new URL(guideFiles[topic], guideRoot),
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
    throw new AppError(
      "GUIDE_TOPIC_NOT_FOUND",
      "Authoring guide topic does not exist",
      404,
    );
  return { version: current.version, topic, body, topics: authoringTopics };
}
