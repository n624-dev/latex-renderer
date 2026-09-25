import type { StructuredErrors } from "@latex-renderer/contracts";

export function parseCompileLog(
  log: string,
  exitCode: number | null,
  entrypoint = "main.tex",
  fallbackMessage?: string,
): StructuredErrors {
  const errors: StructuredErrors["errors"] = [];
  const warnings: StructuredErrors["warnings"] = [];
  for (const raw of log.split(/\r?\n/)) {
    const line = sanitize(raw);
    const fileError = parseFileError(line);
    if (fileError !== null) {
      if (errors.length < 200) errors.push(fileError);
    } else {
      const box = /^(Overfull|Underfull) \\[hv]box\b/.exec(line);
      if (box !== null && warnings.length < 500) {
        const affectedLine = /\bat lines? (\d+)(?:--\d+)?\b/.exec(line);
        warnings.push({
          type: String(box[1]).toLowerCase(),
          file: null,
          line: affectedLine === null ? null : Number(affectedLine[1]),
          message: line.slice(0, 2000),
        });
      } else if (
        warnings.length < 500 &&
        /^(LaTeX|Package .*?) Warning:/.test(line)
      ) {
        warnings.push({
          type: "latex-warning",
          file: null,
          line: null,
          message: line.slice(0, 2000),
        });
      }
    }
    if (errors.length >= 200 && warnings.length >= 500) break;
  }
  if (exitCode !== null && exitCode !== 0 && errors.length === 0) {
    errors.push({
      file: projectPath(entrypoint),
      line: null,
      message:
        fallbackMessage ?? `Compilation failed with exit code ${exitCode}`,
    });
  }
  return { success: exitCode === 0, exitCode, errors, warnings };
}

function parseFileError(
  line: string,
): StructuredErrors["errors"][number] | null {
  const marker = /\.(?:tex|sty|cls):(\d+):/i.exec(line);
  if (marker === null) return null;
  const extensionEnd = marker.index + marker[0].indexOf(":");
  const lineNumber = Number(marker[1]);
  if (!Number.isSafeInteger(lineNumber)) return null;
  const message = line.slice(marker.index + marker[0].length).trimStart();
  if (message.length === 0) return null;
  return {
    file: projectPath(line.slice(0, extensionEnd)),
    line: lineNumber,
    message: message.slice(0, 2000),
  };
}

export function parseRecorder(recorder: string): {
  inputs: string[];
  outputs: string[];
} {
  const inputs = new Set<string>();
  const outputs = new Set<string>();
  for (const raw of recorder.split(/\r?\n/)) {
    const match = /^(INPUT|OUTPUT) (.+)$/.exec(sanitize(raw));
    if (match === null) continue;
    const path = projectPath(String(match[2]));
    if (
      path.startsWith("/") ||
      /^[A-Za-z]:/.test(path) ||
      path.split("/").includes("..")
    )
      continue;
    (match[1] === "INPUT" ? inputs : outputs).add(path);
  }
  return {
    inputs: [...inputs].sort().slice(0, 5000),
    outputs: [...outputs].sort().slice(0, 5000),
  };
}

function sanitize(value: string): string {
  return value.replace(
    // eslint-disable-next-line no-control-regex -- remove terminal control bytes from untrusted logs.
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u009b]/g,
    "",
  );
}
function projectPath(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replace(/^\/work\/input\//, "")
    .replace(/^\/work\/output\//, "")
    .slice(0, 500);
}
