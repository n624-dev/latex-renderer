import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { JobRow } from "@latex-renderer/database";
import {
  diagnosticCoverageSchema,
  type JobStages,
  type RenderEngine,
} from "@latex-renderer/contracts";
import { AppError } from "@latex-renderer/shared";

export interface RemoteRenderDiagnostic {
  severity: "error" | "warning";
  type: string;
  file: string | null;
  line: number | null;
  column: number | null;
  message: string;
  logLine?: number;
  messageTruncated?: boolean;
  tool?: string;
}

export interface RemoteRenderDiagnostics {
  jobId: string;
  status: JobRow["status"];
  engine: RenderEngine;
  diagnostics: RemoteRenderDiagnostic[];
  logExcerpt: string;
  rawLogResourceUri: string | null;
  coverage: {
    parser: ReturnType<typeof diagnosticCoverageSchema.parse> | null;
    storedItems: number;
    offset: number;
    nextOffset: number | null;
    storedListOmitted: number;
    logStatus: "absent" | "available" | "unavailable";
    logExcerptTruncated: boolean;
  };
  retryable: boolean;
  stage?: "pdf" | "svg";
}

export async function renderDiagnostics({
  row,
  stages,
  selectedStage,
  stageWasRequested,
  offset,
  limit,
  errorsJson,
  readLog,
  rawLogResourceUri = null,
}: {
  row: Pick<JobRow, "id" | "status" | "engine">;
  stages: JobStages | undefined;
  selectedStage: "pdf" | "svg";
  stageWasRequested: boolean;
  offset: number | undefined;
  limit: number | undefined;
  errorsJson: string | undefined;
  readLog?: () => Promise<{ text: string; startByte: number }>;
  rawLogResourceUri?: string | null;
}): Promise<RemoteRenderDiagnostics> {
  const parsed =
    errorsJson === undefined
      ? { errors: [], warnings: [], coverage: null, storedListOmitted: 0 }
      : parseDiagnosticsJson(errorsJson);
  const entries: RemoteRenderDiagnostic[] = [
    ...parsed.errors.map((item) => ({
      ...item,
      severity: "error" as const,
      column: null,
    })),
    ...parsed.warnings.map((item) => ({
      ...item,
      severity: "warning" as const,
      column: null,
    })),
  ];
  const start = offset ?? 0;
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    start > entries.length ||
    (limit !== undefined &&
      (!Number.isSafeInteger(limit) || limit < 1 || limit > 25))
  )
    throw new AppError(
      "DIAGNOSTICS_RANGE",
      "Diagnostic page is outside stored results",
      416,
    );
  const diagnostics = entries.slice(
    start,
    start + (limit ?? (offset === undefined ? entries.length : 25)),
  );
  const log = (await readLog?.().catch(() => null)) ?? null;
  const excerpt = log === null ? null : diagnosticLogExcerpt(log.text, entries);
  return {
    jobId: row.id,
    status: row.status,
    engine: row.engine,
    diagnostics,
    logExcerpt: excerpt?.text ?? "",
    rawLogResourceUri,
    coverage: {
      parser: parsed.coverage,
      storedItems: entries.length,
      offset: start,
      nextOffset:
        start + diagnostics.length < entries.length
          ? start + diagnostics.length
          : null,
      storedListOmitted: parsed.storedListOmitted,
      logStatus:
        readLog === undefined ? "absent" : log ? "available" : "unavailable",
      logExcerptTruncated:
        log !== null && (log.startByte > 0 || excerpt?.truncated === true),
    },
    retryable:
      ["failed", "timeout", "rejected"].includes(row.status) ||
      (row.status === "canceled" &&
        stages?.pdf.status === "succeeded" &&
        stages.svg.attempt < 8),
    ...(stages === undefined && !stageWasRequested
      ? {}
      : { stage: selectedStage }),
  };
}

export function assertLogRange(
  size: number,
  startByte: number | undefined,
  startLine: number | undefined,
): void {
  if (
    (startByte !== undefined &&
      (!Number.isSafeInteger(startByte) ||
        startByte < 0 ||
        startByte > size ||
        startLine !== undefined)) ||
    (startLine !== undefined &&
      (!Number.isSafeInteger(startLine) || startLine < 1))
  )
    throw new AppError("LOG_RANGE_INVALID", "Invalid compile log range", 416);
}

export async function readLogWindow(
  path: string,
  signal: AbortSignal,
  size: number,
  startByte: number | undefined,
  startLine: number | undefined,
  maxBytes: number,
) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size !== size)
      throw new AppError(
        "LOG_UNAVAILABLE",
        "The stored compile log cannot be read",
        409,
      );
    let start = startByte ?? Math.max(0, size - maxBytes);
    if (startLine !== undefined)
      start = await locateLogLine(
        file,
        startLine,
        AbortSignal.any([signal, AbortSignal.timeout(3000)]),
      );
    const bytes = Buffer.alloc(Math.min(maxBytes, size - start));
    const { bytesRead } = await file.read(bytes, 0, bytes.length, start);
    signal.throwIfAborted();
    if (bytesRead !== bytes.length)
      throw new AppError(
        "LOG_UNAVAILABLE",
        "The stored compile log cannot be read",
        409,
      );
    // Avoid cutting a UTF-8 code point at the end of a requested page.
    let end = bytesRead;
    if (start + bytesRead < size) {
      const leading = Buffer.alloc(1);
      while (end > 0) {
        const next = await file.read(leading, 0, 1, start + end);
        if (next.bytesRead !== 1)
          throw new AppError(
            "LOG_UNAVAILABLE",
            "The stored compile log cannot be read",
            409,
          );
        if ((leading.readUInt8(0) & 0xc0) !== 0x80) break;
        end--;
      }
    }
    let begin = 0;
    if (start > 0 && startLine === undefined)
      while (begin < end && (bytes.readUInt8(begin) & 0xc0) === 0x80) begin++;
    return {
      startByte: start + begin,
      endByte: start + end,
      totalBytes: size,
      startLine: startLine ?? (start === 0 ? 1 : null),
      nextByte: start + end < size ? start + end : null,
      text: sanitizeLog(bytes.subarray(begin, end).toString("utf8")),
    };
  } finally {
    await file.close();
  }
}

type ParsedDiagnosticItem = Omit<RemoteRenderDiagnostic, "severity" | "column">;

function parseDiagnosticsJson(value: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new AppError("DIAGNOSTICS_INVALID", "Stored diagnostics are invalid");
  }
  if (typeof parsed !== "object" || parsed === null)
    throw new AppError("DIAGNOSTICS_INVALID", "Stored diagnostics are invalid");
  const object = parsed as {
    errors?: unknown;
    warnings?: unknown;
    coverage?: unknown;
  };
  const coverage = diagnosticCoverageSchema.safeParse(object.coverage);
  const count = (entries: unknown): number =>
    Array.isArray(entries) ? Math.max(0, entries.length - 500) : 0;
  return {
    errors: diagnosticItems(object.errors, "latex-error"),
    warnings: diagnosticItems(object.warnings, "latex-warning"),
    coverage: coverage.success ? coverage.data : null,
    storedListOmitted: count(object.errors) + count(object.warnings),
  };
}

function diagnosticItems(
  value: unknown,
  fallbackType: string,
): ParsedDiagnosticItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.message !== "string") return [];
    const logLine = candidate.logLine;
    return [
      {
        type:
          typeof candidate.type === "string"
            ? candidate.type.slice(0, 100)
            : fallbackType,
        file:
          typeof candidate.file === "string"
            ? candidate.file.slice(0, 500)
            : null,
        line:
          typeof candidate.line === "number" &&
          Number.isSafeInteger(candidate.line)
            ? candidate.line
            : null,
        message: candidate.message.slice(0, 2000),
        ...(typeof logLine === "number" &&
        Number.isSafeInteger(logLine) &&
        logLine > 0
          ? { logLine }
          : {}),
        ...(candidate.messageTruncated === true ||
        candidate.message.length > 2000
          ? { messageTruncated: true }
          : {}),
        ...(typeof candidate.tool === "string"
          ? { tool: candidate.tool.slice(0, 50) }
          : {}),
      },
    ];
  });
}

function diagnosticLogExcerpt(
  text: string,
  entries: readonly RemoteRenderDiagnostic[],
) {
  const lines = text.split(/\r?\n/);
  const needle = entries
    .find((item) => item.severity === "error")
    ?.message.slice(0, 160);
  const match = needle ? lines.findIndex((line) => line.includes(needle)) : -1;
  const start =
    match < 0 ? Math.max(0, lines.length - 80) : Math.max(0, match - 12);
  const end = match < 0 ? lines.length : Math.min(lines.length, match + 12);
  return {
    text: lines.slice(start, end).join("\n"),
    truncated: start > 0 || end < lines.length,
  };
}

function sanitizeLog(value: string): string {
  return value.replace(
    // eslint-disable-next-line no-control-regex -- renderer logs are untrusted input.
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u009b]/g,
    "",
  );
}

async function locateLogLine(
  file: Awaited<ReturnType<typeof open>>,
  line: number,
  signal: AbortSignal,
): Promise<number> {
  if (line === 1) return 0;
  const bytes = Buffer.alloc(64 * 1024);
  let position = 0;
  let current = 1;
  for (;;) {
    signal.throwIfAborted();
    const { bytesRead } = await file.read(bytes, 0, bytes.length, position);
    if (bytesRead === 0)
      throw new AppError(
        "LOG_RANGE_INVALID",
        "Log line is outside the stored log",
        416,
      );
    const window = bytes.subarray(0, bytesRead);
    for (let at = window.indexOf(10); at >= 0; at = window.indexOf(10, at + 1))
      if (++current === line) return position + at + 1;
    position += bytesRead;
  }
}
