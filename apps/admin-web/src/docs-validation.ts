import { renderEngineSchema } from "@latex-renderer/contracts";
import type { PublicDoc } from "./markdown-docs.js";

export interface OpenApiDocument {
  name: string;
  publicPath: string;
  source: string;
}

export interface DocsValidationInput {
  docs: readonly PublicDoc[];
  localizedDocs?: ReadonlyArray<{ root: string; docs: readonly PublicDoc[] }>;
  publicPaths: readonly string[];
  openApis: readonly OpenApiDocument[];
  resolveCliHelp: (commandPath: string) => string | undefined;
}

type CliBinary = "latex-render" | "n624-latex";
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
  localizedDocs = [],
  publicPaths,
  openApis,
  resolveCliHelp,
}: DocsValidationInput): string[] {
  const errors: string[] = [];
  const docsByPath = new Map(
    [{ root: "/docs/", docs }, ...localizedDocs].flatMap(({ root, docs }) =>
      docs.map((doc) => [docUrl(doc.slug, root), doc] as const),
    ),
  );
  const knownPaths = new Set([...publicPaths, ...docsByPath.keys()]);

  for (const [path, doc] of docsByPath) {
    for (const target of markdownLinks(doc.markdown)) {
      validateLink(doc, path, target, knownPaths, docsByPath, errors);
    }
  }

  validateCliExamples([...docsByPath.values()], resolveCliHelp, errors);
  validateMcpExamples(docs, errors);
  validateOpenApiCoverage(docs, openApis, errors);
  return errors;
}

function validateLink(
  source: PublicDoc,
  sourceUrl: string,
  target: string,
  knownPaths: ReadonlySet<string>,
  docsByPath: ReadonlyMap<string, PublicDoc>,
  errors: string[],
): void {
  if (/^(?:https?:|mailto:)/i.test(target)) return;
  let url: URL;
  try {
    url = new URL(target, `https://docs.invalid${sourceUrl}`);
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
    !(linkedDoc.headings.some(({ id }) => id === fragment) ||
      (linkedDoc.anchorAliases !== undefined && Object.hasOwn(linkedDoc.anchorAliases, fragment)))
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
    for (const { binary, invocation } of cliInvocations(doc.markdown)) {
      const engine = renderEngineSchema.safeParse(
        invocation.split(/\s+/, 1)[0],
      );
      const commandPath =
        binary === "n624-latex" &&
        /^[^\s-][^\s]*\.tex(?:\s|$)/i.test(invocation)
          ? "compile"
          : engine.success
            ? engine.data
            : documentedCommandPath(invocation);
      const compile = commandPath === "compile" || engine.success;
      const helpBinary = compile ? "n624-latex" : "latex-render";
      const usage = `Usage: ${helpBinary} ${commandPath}`.trimEnd();
      let help = cache.get(commandPath);
      if (!cache.has(commandPath)) {
        help = resolveCliHelp(commandPath);
        cache.set(commandPath, help);
      }
      if (
        help === undefined ||
        !help.includes(usage) ||
        (compile && binary !== "n624-latex")
      ) {
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

function cliInvocations(
  markdown: string,
): Array<{ binary: CliBinary; invocation: string }> {
  return codeBlockLines(markdown).flatMap((line) => {
    if (line.trimStart().startsWith("#")) return [];
    const match = line.match(/\b(latex-render|n624-latex)\s+(.+?)\s*$/);
    const binary = match?.[1];
    const invocation = match?.[2];
    if (
      (binary !== "n624-latex" && binary !== "latex-render") ||
      invocation === undefined ||
      (binary === "n624-latex" && /^(?:admin|server)\b/.test(invocation))
    )
      return [];
    return [{ binary, invocation }];
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
  const source = markdown.replace(/^> ?/gm, "");
  return [
    ...source.matchAll(/^ {0,3}```[^\n]*\n([\s\S]*?)^ {0,3}```/gm),
  ].flatMap((match) => match[1]?.split("\n") ?? []);
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
        /^(?:>[ \t]*)?\|([^|\n]+)\|[ \t]*`(\/api\/v1\/[^`]+)`/gm,
      ),
    ].flatMap((match) => {
      const methodCell = match[1] ?? "";
      return [...methodCell.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\b/g)].map(
        ([method]) => `${method} ${match[2]}`,
      );
    }),
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

function docUrl(slug: string, root: string): string {
  return slug === "index" ? root : `${root}${slug}/`;
}
