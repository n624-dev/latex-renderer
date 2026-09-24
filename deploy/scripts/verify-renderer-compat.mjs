import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export function verifyRendererCompat(log, manifest) {
  const references = { compile: [], objects: [] };
  for (const [, jobname, value] of log.matchAll(
    /LR-COMPAT-REF-(compile|objects)=([^\r\n]+)/g,
  )) {
    references[jobname].push(value.trim());
  }
  const resolved = {};
  for (const [jobname, values] of Object.entries(references)) {
    // \meaning of \newlabel's control sequence is macro:->{number}{page}...
    // The PDF and SVG preview page numbers may differ; compare the first group.
    const reference = /^macro:->\{([^{}]+)\}/.exec(values.at(-1) ?? "")?.[1];
    if (values.length < 2 || values[0] !== "UNRESOLVED" || !reference)
      throw new Error(
        `${jobname} did not resolve the same equation reference after multiple passes: ${values.join(", ")}`,
      );
    resolved[jobname] = reference;
  }
  if (resolved.compile !== "1" || resolved.objects !== resolved.compile)
    throw new Error(`PDF/SVG reference mismatch: ${JSON.stringify(resolved)}`);
  if (
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.objects) ||
    manifest.objects.length < 2
  )
    throw new Error("SVG capture is missing reference-dependent math objects");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.length !== 4)
    throw new Error("Usage: verify-renderer-compat.mjs LOG MANIFEST");
  const log = await readFile(process.argv[2], "utf8");
  const manifest = JSON.parse(await readFile(process.argv[3], "utf8"));
  verifyRendererCompat(log, manifest);
}
