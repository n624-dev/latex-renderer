import type { StructuredErrors } from "@latex-renderer/contracts";

export function parseCompileLog(log: string, exitCode: number | null): StructuredErrors {
  const errors: StructuredErrors["errors"] = [];
  const warnings: StructuredErrors["warnings"] = [];
  for (const raw of log.split(/\r?\n/)) {
    const line = sanitize(raw);
    const fileError = /^(.*?\.tex):(\d+):\s*(.+)$/.exec(line);
    if (fileError !== null) {
      errors.push({ file: projectPath(String(fileError[1])), line: Number(fileError[2]), message: String(fileError[3]).slice(0, 2000) });
      continue;
    }
    const overfull = /^(Overfull|Underfull) \\[hv]box.*(?:at lines? (\d+))?/.exec(line);
    if (overfull !== null) warnings.push({ type: String(overfull[1]).toLowerCase(), file: null,
      line: overfull[2] === undefined ? null : Number(overfull[2]), message: line.slice(0, 2000) });
    else if (/^(LaTeX|Package .*?) Warning:/.test(line)) warnings.push({ type: "latex-warning", file: null, line: null, message: line.slice(0, 2000) });
    if (errors.length >= 200 || warnings.length >= 500) break;
  }
  if (exitCode !== null && exitCode !== 0 && errors.length === 0) {
    errors.push({ file: "main.tex", line: null, message: `Compilation failed with exit code ${exitCode}` });
  }
  return { success: exitCode === 0, exitCode, errors, warnings };
}

export function parseRecorder(recorder: string): { inputs: string[]; outputs: string[] } {
  const inputs = new Set<string>(); const outputs = new Set<string>();
  for (const raw of recorder.split(/\r?\n/)) {
    const match = /^(INPUT|OUTPUT) (.+)$/.exec(sanitize(raw));
    if (match === null) continue;
    const path = projectPath(String(match[2]));
    if (path.startsWith("/") || path.includes("..")) continue;
    (match[1] === "INPUT" ? inputs : outputs).add(path);
  }
  return { inputs: [...inputs].sort().slice(0, 5000), outputs: [...outputs].sort().slice(0, 5000) };
}

// eslint-disable-next-line no-control-regex -- remove terminal control bytes from untrusted logs.
function sanitize(value: string): string { return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u009b]/g, ""); }
function projectPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/work\/input\//, "").replace(/^\/work\/output\//, "").slice(0, 500);
}
