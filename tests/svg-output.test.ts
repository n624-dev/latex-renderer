import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createRenderTicketRequestSchema } from "../packages/contracts/src/index.js";
import {
  validateArtifacts,
  type ValidatedArtifact,
} from "../apps/renderer-worker/src/artifact-validator.js";
import type { WorkerConfig } from "../apps/renderer-worker/src/config.js";

const roots: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("optional SVG artifacts", () => {
  it("defaults to PDF and accepts an explicit PDF plus SVG request", () => {
    const schema = createRenderTicketRequestSchema();
    expect(
      schema.parse({ sourceId: `source_${"a".repeat(32)}` }).outputs,
    ).toEqual(["pdf"]);
    expect(
      schema.parse({
        sourceId: `source_${"a".repeat(32)}`,
        outputs: ["pdf", "svg"],
      }).outputs,
    ).toEqual(["pdf", "svg"]);
    expect(
      schema.safeParse({
        sourceId: `source_${"a".repeat(32)}`,
        outputs: ["svg"],
      }).success,
    ).toBe(false);
  });

  it("emits an empty manifest when the document has no extractable objects", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-svg-empty-")),
      metadata = join(root, "objects.meta"),
      output = join(root, "svg");
    roots.push(root);
    await writeFile(metadata, "");
    await execFileAsync("perl", [
      new URL("../renderer/export-svg.pl", import.meta.url).pathname,
      join(root, "missing-capture.pdf"),
      metadata,
      join(root, "missing-canonical.pdf"),
      output,
    ]);
    const manifest = JSON.parse(
      await readFile(join(output, "manifest.json"), "utf8"),
    ) as { objects: unknown[] };
    expect(manifest.objects).toEqual([]);
  });
  it("accepts a complete, self-contained SVG set", async () => {
    const directory = await fixture(
      '<image href="data:image/png;base64,iVBORw0KGgo="/>',
    );
    const artifacts = await validateArtifacts(
      config(directory),
      directory,
      false,
      true,
    );

    expect(svgArtifacts(artifacts).map((item) => item.path)).toEqual([
      "svg/manifest.json",
      "svg/objects/math-000001.svg",
    ]);
  });

  it.each([
    ["script", '<script xmlns="http://www.w3.org/2000/svg">alert(1)</script>'],
    [
      "event handler",
      '<path xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    ],
    [
      "external reference",
      '<image xmlns="http://www.w3.org/2000/svg" href="https://example.test/a.png"/>',
    ],
    [
      "local file reference",
      '<image xmlns="http://www.w3.org/2000/svg" href="file:///etc/passwd"/>',
    ],
    [
      "JavaScript reference",
      '<a xmlns="http://www.w3.org/2000/svg" href="javascript:alert(1)"/>',
    ],
    [
      "nested SVG data reference",
      '<image xmlns="http://www.w3.org/2000/svg" href="data:image/svg+xml;base64,PHN2Zy8+"/>',
    ],
    [
      "external CSS URL",
      '<path xmlns="http://www.w3.org/2000/svg" style="fill:url(https://example.test/a.svg)"/>',
    ],
    ["foreignObject", '<foreignObject xmlns="http://www.w3.org/2000/svg"/>'],
  ])("rejects SVG active content: %s", async (_name, content) => {
    const directory = await fixture(content);
    await expect(
      validateArtifacts(config(directory), directory, false, true),
    ).rejects.toMatchObject({ code: "SVG_UNSAFE" });
  });

  it("rejects partial output when manifest and object counts differ", async () => {
    const directory = await fixture();
    await writeFile(
      join(directory, "svg", "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        coordinateSystem: coordinateSystem,
        objects: [],
      }),
    );

    await expect(
      validateArtifacts(config(directory), directory, false, true),
    ).rejects.toMatchObject({ code: "SVG_COUNT_MISMATCH" });
  });
});

const coordinateSystem = {
  unit: "pdf-point",
  origin: "top-left",
  xAxis: "right",
  yAxis: "down",
};

async function fixture(extra = ""): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "latex-svg-output-"));
  roots.push(root);
  await mkdir(join(root, "svg", "objects"), { recursive: true });
  await writeFile(join(root, "compile.log"), "compiled\n");
  await writeFile(join(root, "errors.json"), '{"errors":[]}\n');
  await writeFile(
    join(root, "svg", "objects", "math-000001.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" width="10pt" height="5pt" viewBox="0 0 10 5"><path d="M0 0h1"/>${extra}</svg>`,
  );
  await writeFile(
    join(root, "svg", "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      coordinateSystem,
      objects: [
        {
          id: 1,
          kind: "math",
          artifact: "svg/objects/math-000001.svg",
          sourceFile: "main.tex",
          sourceLine: 3,
          page: 1,
          x: 20,
          y: 30,
          width: 10,
          height: 5,
        },
      ],
    }),
  );
  return root;
}

function svgArtifacts(artifacts: ValidatedArtifact[]): ValidatedArtifact[] {
  return artifacts
    .filter((item) => item.type === "svg" || item.type === "svg_manifest")
    .sort((left, right) => left.path.localeCompare(right.path));
}

function config(storageRoot: string): WorkerConfig {
  return {
    databasePath: ":memory:",
    storageRoot,
    image: `sha256:${"0".repeat(64)}`,
    workerId: "worker_test",
    seccompProfile: "/tmp/seccomp.json",
    apparmorProfile: undefined,
    maxUploadBytes: 20 * 1024 * 1024,
    maxExtractedBytes: 100 * 1024 * 1024,
    maxFileCount: 500,
    maxZipEntries: 1_000,
    maxOutputBytes: 200 * 1024 * 1024,
    maxOutputFileCount: 2_000,
    maxOutputDirectoryCount: 200,
    maxLogBytes: 10 * 1024 * 1024,
    maxSvgObjects: 200,
    maxSvgBytes: 10 * 1024 * 1024,
    maxSvgTotalBytes: 100 * 1024 * 1024,
    svgConversionTimeoutSeconds: 120,
    containerUid: 10_000,
    containerGid: 10_000,
    jobTimeoutMs: 420_000,
  };
}
