import type { PublicDoc } from "./markdown-docs.js";

export interface OpenApiDocument {
  name: string;
  publicPath: string;
  source: string;
}

export interface DocsValidationInput {
  docs: readonly PublicDoc[];
  publicPaths: readonly string[];
  openApis: readonly OpenApiDocument[];
  resolveCliHelp: (commandPath: string) => string | undefined;
}

const methods = "get|post|put|patch|delete|head|options";
const globalCliOptions = new Set(["--json"]);
const setupCliOptions = new Set([
  "--base-uri",
  "--install-directory",
  "--bin-directory",
  "--skill-target",
  "--mcp-target",
  "--api-key-stdin",
]);
const mcpSetupCommands = [
  "codex mcp add latex-renderer -- latex-renderer-mcp",
  "claude mcp add --scope user latex-renderer -- latex-renderer-mcp",
] as const;

export function assertPublicDocsValid(input: DocsValidationInput): void {
  const errors = validatePublicDocs(input);
  if (errors.length !== 0) {
    throw new Error(
      `Public documentation validation failed:\n- ${errors.join("\n- ")}`,
    );
  }
}

export function validatePublicDocs({
  docs,
  publicPaths,
  openApis,
  resolveCliHelp,
}: DocsValidationInput): string[] {
  const errors: string[] = [];
  const docsByPath = new Map(docs.map((doc) => [docUrl(doc.slug), doc]));
  const knownPaths = new Set([...publicPaths, ...docsByPath.keys()]);

  for (const doc of docs) {
    for (const target of markdownLinks(doc.markdown)) {
      validateLink(doc, target, knownPaths, docsByPath, errors);
    }
  }

  validateCliExamples(docs, resolveCliHelp, errors);
  validateMcpExamples(docs, errors);
  validateOpenApiCoverage(docs, openApis, errors);
  return errors;
}

function validateLink(
  source: PublicDoc,
  target: string,
  knownPaths: ReadonlySet<string>,
  docsByPath: ReadonlyMap<string, PublicDoc>,
  errors: string[],
): void {
  if (/^(?:https?:|mailto:)/i.test(target)) return;
  let url: URL;
  try {
    url = new URL(target, `https://docs.invalid${docUrl(source.slug)}`);
  } catch {
    errors.push(`${source.sourcePath}: invalid link ${target}`);
    return;
  }
  if (url.origin !== "https://docs.invalid") return;
  const path = decodeURIComponent(url.pathname);
  if (!knownPaths.has(path)) {
    errors.push(`${source.sourcePath}: broken internal link ${target}`);
    return;
  }
  if (url.hash === "") return;
  const linkedDoc = docsByPath.get(path);
  const fragment = decodeURIComponent(url.hash.slice(1));
  if (
    linkedDoc === undefined ||
    !linkedDoc.headings.some(({ id }) => id === fragment)
  ) {
    errors.push(`${source.sourcePath}: missing heading anchor ${target}`);
  }
}

function markdownLinks(markdown: string): string[] {
  return [
    ...markdown.matchAll(
      /(?<!!)\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^)]*["'])?\)/g,
    ),
  ].flatMap((match) => {
    const target = match[1] ?? match[2];
    return target === undefined ? [] : [target];
  });
}

function validateCliExamples(
  docs: readonly PublicDoc[],
  resolveCliHelp: (commandPath: string) => string | undefined,
  errors: string[],
): void {
  const cache = new Map<string, string | undefined>();
  for (const doc of docs) {
    for (const invocation of cliInvocations(doc.markdown)) {
      const commandPath = documentedCommandPath(invocation);
      let help = cache.get(commandPath);
      if (!cache.has(commandPath)) {
        help = resolveCliHelp(commandPath);
        cache.set(commandPath, help);
      }
      const usage = `Usage: latex-render ${commandPath}`;
      if (help === undefined || !help.includes(usage)) {
        errors.push(
          `${doc.sourcePath}: unknown CLI command in \`${invocation}\``,
        );
        continue;
      }
      for (const option of invocation.match(/--[a-z][a-z0-9-]*/g) ?? []) {
        if (globalCliOptions.has(option)) continue;
        if (commandPath.startsWith("setup ") && setupCliOptions.has(option))
          continue;
        if (!help.includes(option)) {
          errors.push(
            `${doc.sourcePath}: unknown CLI option ${option} in \`${invocation}\``,
          );
        }
      }
    }
  }
}

function cliInvocations(markdown: string): string[] {
  return codeBlockLines(markdown).flatMap((line) => {
    const match = line.match(/\blatex-render\s+(.+?)\s*$/);
    return match?.[1] === undefined ? [] : [match[1].trim()];
  });
}

function documentedCommandPath(invocation: string): string {
  const tokens = invocation.split(/\s+/);
  const commands: string[] = [];
  for (const token of tokens) {
    if (
      token.startsWith("-") ||
      token.startsWith("[") ||
      token.startsWith("<") ||
      token === "." ||
      /[\\/:]/.test(token)
    )
      break;
    commands.push(token);
  }
  return commands.join(" ");
}

function validateMcpExamples(
  docs: readonly PublicDoc[],
  errors: string[],
): void {
  const counts = new Map<string, number>(
    mcpSetupCommands.map((command) => [command, 0]),
  );
  for (const doc of docs) {
    for (const line of codeBlockLines(doc.markdown)) {
      const command = line.trim();
      if (!/^(?:codex|claude) mcp add\b/.test(command)) continue;
      if (!counts.has(command)) {
        errors.push(
          `${doc.sourcePath}: invalid MCP setup command \`${command}\``,
        );
        continue;
      }
      counts.set(command, (counts.get(command) ?? 0) + 1);
    }
  }
  for (const [command, count] of counts) {
    if (count === 0) errors.push(`missing MCP setup example \`${command}\``);
  }
}

function codeBlockLines(markdown: string): string[] {
  return [...markdown.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].flatMap(
    (match) => match[1]?.split("\n") ?? [],
  );
}

function validateOpenApiCoverage(
  docs: readonly PublicDoc[],
  openApis: readonly OpenApiDocument[],
  errors: string[],
): void {
  const markdown = docs.map(({ markdown: source }) => source).join("\n");
  const documented = new Set(
    [
      ...markdown.matchAll(
        /^\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*`(\/api\/v1\/[^`]+)`/gm,
      ),
    ].map((match) => `${match[1]} ${match[2]}`),
  );
  const specified = new Set<string>();
  for (const openApi of openApis) {
    for (const operation of openApiOperations(openApi.source))
      specified.add(operation);
    if (!markdownLinks(markdown).includes(openApi.publicPath)) {
      errors.push(`missing link to ${openApi.name} at ${openApi.publicPath}`);
    }
  }
  for (const operation of specified) {
    if (!documented.has(operation))
      errors.push(`OpenAPI operation is undocumented: ${operation}`);
  }
  for (const operation of documented) {
    if (!specified.has(operation))
      errors.push(
        `documented API operation is absent from OpenAPI: ${operation}`,
      );
  }
}

function openApiOperations(source: string): string[] {
  const operations: string[] = [];
  let inPaths = false;
  let path: string | undefined;
  for (const line of source.split("\n")) {
    if (line === "paths:") {
      inPaths = true;
      continue;
    }
    if (!inPaths) continue;
    if (/^[^\s]/.test(line)) break;
    const pathMatch = line.match(/^ {2}(\/[^:]+):\s*$/);
    if (pathMatch?.[1] !== undefined) {
      path = pathMatch[1];
      continue;
    }
    const methodMatch = line.match(new RegExp(`^ {4}(${methods}):\\s*$`, "i"));
    if (path !== undefined && methodMatch?.[1] !== undefined)
      operations.push(`${methodMatch[1].toUpperCase()} ${path}`);
  }
  return operations;
}

function docUrl(slug: string): string {
  return slug === "index" ? "/docs/" : `/docs/${slug}/`;
}
