import type { StructuredErrors } from "@latex-renderer/contracts";

export function parseCompileLog(
  log: string,
  exitCode: number | null,
): StructuredErrors {
  const errors: StructuredErrors["errors"] = [];
  const warnings: StructuredErrors["warnings"] = [];
  for (const raw of log.split(/\r?\n/)) {
    const line = sanitize(raw);
    const fileError = parseFileError(line);
    if (fileError !== null) {
      errors.push(fileError);
      continue;
    }
    const overfull =
      /^(Overfull|Underfull) \\[hv]box.*(?:at lines? (\d+))?/.exec(line);
    if (overfull !== null)
      warnings.push({
        type: String(overfull[1]).toLowerCase(),
        file: null,
        line: overfull[2] === undefined ? null : Number(overfull[2]),
        message: line.slice(0, 2000),
      });
    else if (/^(LaTeX|Package .*?) Warning:/.test(line))
      warnings.push({
        type: "latex-warning",
        file: null,
        line: null,
        message: line.slice(0, 2000),
      });
    if (errors.length >= 200 || warnings.length >= 500) break;
  }
  if (exitCode !== null && exitCode !== 0 && errors.length === 0) {
    errors.push({
      file: "main.tex",
      line: null,
      message: `Compilation failed with exit code ${exitCode}`,
    });
  }
  return { success: exitCode === 0, exitCode, errors, warnings };
}

function parseFileError(
  line: string,
): StructuredErrors["errors"][number] | null {
  const fileEnd = line.indexOf(".tex:");
  if (fileEnd < 0) return null;
  const lineStart = fileEnd + ".tex:".length,
    lineEnd = line.indexOf(":", lineStart);
  if (lineEnd < 0 || lineEnd === lineStart) return null;
  const lineNumber = line.slice(lineStart, lineEnd);
  for (let index = 0; index < lineNumber.length; index += 1) {
    const code = lineNumber.charCodeAt(index);
    if (code < 48 || code > 57) return null;
  }
  const message = line.slice(lineEnd + 1).trimStart();
  if (message.length === 0) return null;
  return {
    file: projectPath(line.slice(0, fileEnd + ".tex".length)),
    line: Number(lineNumber),
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
    if (path.startsWith("/") || path.includes("..")) continue;
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
