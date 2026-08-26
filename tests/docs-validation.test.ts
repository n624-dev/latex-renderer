import { describe, expect, it } from "vitest";
import {
  assertPublicDocsValid,
  validatePublicDocs,
  type DocsValidationInput,
} from "../apps/admin-web/src/docs-validation.js";
import {
  docsPage,
  publicDocs,
  type PublicDoc,
} from "../apps/admin-web/src/markdown-docs.js";
import { repositoryDocsValidationInput } from "../docs-check.js";

const cliHelp = new Map([
  ["auth login", "Usage: latex-render auth login\n--api-key-stdin"],
  ["auth status", "Usage: latex-render auth status"],
  ["auth logout", "Usage: latex-render auth logout"],
  ["render", "Usage: latex-render render\n--open"],
  ["jobs get", "Usage: latex-render jobs get"],
  ["jobs cancel", "Usage: latex-render jobs cancel"],
  ["jobs download", "Usage: latex-render jobs download\n--output"],
  ["jobs delete", "Usage: latex-render jobs delete\n--yes"],
]);

describe("public documentation CI validation", () => {
  it("validates the repository against the real CLI and OpenAPI contracts", () => {
    expect(() =>
      assertPublicDocsValid(repositoryDocsValidationInput()),
    ).not.toThrow();
    expect(docsPage()).toContain(
      'href="https://github.com/n624-dev/latex-renderer/edit/main/docs/public/index.md"',
    );
  });

  it("detects broken internal routes and heading anchors", () => {
    const docs = replaceMarkdown(
      "index",
      "\n[missing route](/docs/missing/)\n[missing anchor](/docs/cli/#missing)\n",
    );

    expect(validate(docs)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("broken internal link /docs/missing/"),
        expect.stringContaining("missing heading anchor /docs/cli/#missing"),
      ]),
    );
  });

  it("detects CLI command and option drift", () => {
    const docs = replaceMarkdown(
      "cli",
      "\n```text\nlatex-render jobs retry <jobId>\nlatex-render render . --preview\n```\n",
    );

    expect(validate(docs)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("unknown CLI command"),
        expect.stringContaining("unknown CLI option --preview"),
      ]),
    );
  });

  it("detects MCP setup drift", () => {
    const docs = publicDocs.map((doc) =>
      doc.slug === "mcp"
        ? {
            ...doc,
            markdown: doc.markdown.replace(
              "codex mcp add latex-renderer -- latex-renderer-mcp",
              "codex mcp add latex-renderer -- wrong-mcp",
            ),
          }
        : doc,
    );

    expect(validate(docs)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("invalid MCP setup command"),
      ]),
    );
  });

  it("detects OpenAPI operations missing from the docs", () => {
    const input = testInput(publicDocs);
    const gateway = input.openApis[0];
    if (gateway === undefined)
      throw new Error("Gateway OpenAPI fixture missing");
    input.openApis = [
      {
        ...gateway,
        source: gateway.source.replace(
          "components:",
          "  /api/v1/undocumented:\n    get:\n      responses: {}\ncomponents:",
        ),
      },
      ...input.openApis.slice(1),
    ];

    expect(validatePublicDocs(input)).toContain(
      "OpenAPI operation is undocumented: GET /api/v1/undocumented",
    );
  });
});

function replaceMarkdown(slug: string, suffix: string): readonly PublicDoc[] {
  return publicDocs.map((doc) =>
    doc.slug === slug ? { ...doc, markdown: `${doc.markdown}${suffix}` } : doc,
  );
}

function validate(docs: readonly PublicDoc[]): string[] {
  return validatePublicDocs(testInput(docs));
}

function testInput(docs: readonly PublicDoc[]): DocsValidationInput {
  const repository = repositoryDocsValidationInput();
  return {
    ...repository,
    docs,
    resolveCliHelp: (commandPath) => cliHelp.get(commandPath),
  };
}
