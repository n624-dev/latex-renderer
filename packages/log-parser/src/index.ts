import type { StructuredErrors } from "@latex-renderer/contracts";

export function parseCompileLog(
  log: string,
  exitCode: number | null,
  entrypoint = "main.tex",
  fallbackMessage?: string,
): StructuredErrors {
  const errors: StructuredErrors["errors"] = [];
  const warnings: StructuredErrors["warnings"] = [];
  const coverage = {
    scannedLines: 0,
    errorsOmitted: 0,
    warningsOmitted: 0,
    messagesTruncated: 0,
  };
  let continued: StructuredErrors["warnings"][number] | undefined;
  let continuationPrefix: string | undefined;
  const bound = (
    item: { message: string; messageTruncated?: boolean | undefined },
    message: string,
  ) => {
    if (message.length > 2000 && item.messageTruncated !== true) {
      item.messageTruncated = true;
      coverage.messagesTruncated++;
    }
    item.message = message.slice(0, 2000);
  };
  for (let start = 0; start < log.length;) {
    const newline = log.indexOf("\n", start);
    const end = newline < 0 ? log.length : newline;
    const line = sanitize(log.slice(start, end)).replace(/\r$/, "");
    start = end + 1;
    const logLine = ++coverage.scannedLines;
    if (
      continued &&
      continuationPrefix &&
      line.startsWith(continuationPrefix)
    ) {
      bound(
        continued,
        `${continued.message} ${line.slice(continuationPrefix.length).trim()}`,
      );
      continue;
    }
    continued = undefined;
    continuationPrefix = undefined;
    const fileError = parseFileError(line);
    if (fileError !== null) {
      if (errors.length >= 200) {
        coverage.errorsOmitted++;
      } else {
        // Keep the existing shape for short errors. A cut message includes its
        // physical line in compile.log for recovery.
        if (fileError.message.length > 2000) fileError.logLine = logLine;
        bound(fileError, fileError.message);
        errors.push(fileError);
      }
      continue;
    }
    const match = /^(Overfull|Underfull) \\[hv]box\b/.exec(line);
    const latex =
      /^(LaTeX(?: Font)?|Package ([^ ]+)|Class ([^ ]+)) Warning:/.exec(line);
    const biberSeverity = /^(?:\[\d+\] [^\n]{0,200}? - )?(WARN|ERROR) - /.exec(
      line,
    )?.[1];
    if (biberSeverity === "ERROR") {
      if (errors.length >= 200) coverage.errorsOmitted++;
      else {
        const item: StructuredErrors["errors"][number] = {
          file: projectPath(entrypoint),
          line: null,
          logLine,
          tool: "biber",
          message: "",
        };
        bound(item, line);
        errors.push(item);
      }
      continue;
    }
    const tool =
      biberSeverity === "WARN"
        ? "biber"
        : /^Warning--/.test(line)
          ? "bibtex"
          : /^dvipdfmx:warning:/.test(line)
            ? "dvipdfmx"
            : undefined;
    const missing = line.startsWith("Missing character:");
    if (!match && !latex && !tool && !missing) continue;
    if (warnings.length >= 500) {
      coverage.warningsOmitted++;
      continue;
    }
    const affectedLine = /\b(?:at lines?|on input line) (\d+)(?:--\d+)?\b/.exec(
      line,
    );
    const item: StructuredErrors["warnings"][number] = {
      type:
        match?.[1]?.toLowerCase() ??
        (missing
          ? "missing-character"
          : tool
            ? `${tool}-warning`
            : latex?.[1] === "LaTeX Font"
              ? "font-warning"
              : "latex-warning"),
      file: null,
      line: affectedLine ? Number(affectedLine[1]) : null,
      logLine,
      message: "",
      ...(tool === undefined ? {} : { tool }),
    };
    bound(item, line);
    warnings.push(item);
    const prefix =
      latex?.[2] ??
      latex?.[3] ??
      (latex?.[1] === "LaTeX Font" ? "Font" : undefined);
    if (prefix !== undefined) {
      continued = item;
      continuationPrefix = `(${prefix})`;
    }
  }
  if (exitCode !== null && exitCode !== 0 && errors.length === 0) {
    errors.push({
      file: projectPath(entrypoint),
      line: null,
      message:
        fallbackMessage ?? `Compilation failed with exit code ${exitCode}`,
    });
  }
  return { success: exitCode === 0, exitCode, errors, warnings, coverage };
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
    message,
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
