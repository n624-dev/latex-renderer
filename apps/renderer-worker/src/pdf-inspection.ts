import { pdfCropRequestSchema } from "@latex-renderer/contracts";
import { pdfCropProgram, readPdfCrop } from "./pdf-crop.js";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  statfs,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ARTIFACT_DOWNLOAD_LEASE_MS,
  artifactStoragePath,
  protectArtifactDownloadLeases,
  type PdfInspectionRow,
  type RendererDatabase,
} from "@latex-renderer/database";
import { AppError, newId, nowIso } from "@latex-renderer/shared";
import { readArtifactSinglePass } from "./artifact-validator.js";
import type { WorkerConfig } from "./config.js";
import {
  dockerStopVerified,
  rendererContainerName,
  RendererCleanupDeferred,
} from "./docker.js";
import { runRendererStage } from "./renderer-stage.js";

// The shell program is static. Neither document metadata nor MCP input is
// substituted into it. Existing Runtime images contain the required tools.
const inspect = String.raw`
umask 0007
export LC_ALL=C.UTF-8
pdf=/work/pdf/result.pdf
cd /work/output
qpdf --version > versions
pdfinfo -v >> versions 2>&1
if timeout -k 2 8 qpdf --check "$pdf" > /tmp/qpdf-check 2>&1; then
  printf 'passed\n' > structure
else
  printf 'requires_review\n' > structure
fi
timeout -k 2 8 pdfinfo -f 1 -l 100 -box "$pdf" > page-info
timeout -k 2 8 pdffonts -f 1 -l 100 "$pdf" > font-info || rm -f font-info
timeout -k 2 8 pdftotext -f 1 -l 100 -enc UTF-8 "$pdf" extracted-text || rm -f extracted-text
timeout -k 2 8 qpdf --json --json-key=outlines --json-key=pages "$pdf" > navigation || rm -f navigation
`;

const resultLimits = {
  versions: 512,
  structure: 100,
  "page-info": 12_000,
  "font-info": 8_000,
  "extracted-text": 8_000,
  navigation: 12_000,
} as const;

type ResultName = keyof typeof resultLimits;

function paths(config: WorkerConfig, id: string) {
  if (!/^inspect_[a-f0-9]{32}$/.test(id))
    throw new Error("Invalid PDF inspection ID");
  const work = join(config.storageRoot, "pdf-inspections", id);
  return { work, input: join(work, "input"), output: join(work, "output") };
}

async function outputText(directory: string, name: ResultName) {
  const path = join(directory, name);
  const info = await lstat(path).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT")
      return undefined;
    throw error;
  });
  if (info === undefined)
    return { status: "not_checked" as const, text: null, truncated: false };
  if (!info.isFile() || info.nlink !== 1)
    throw new Error("Invalid PDF inspection output");
  const size = Math.min(info.size, resultLimits[name]);
  const file = await open(path, "r");
  try {
    const bytes = Buffer.alloc(size);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    const text = bytes
      .subarray(0, bytesRead)
      .toString("utf8")
      // eslint-disable-next-line no-control-regex -- PDF and inspection output are untrusted.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
    return {
      status: "observed" as const,
      text,
      truncated: info.size > bytesRead,
    };
  } finally {
    await file.close();
  }
}

async function cleanup(config: WorkerConfig, id: string) {
  const { work } = paths(config, id);
  const info = await lstat(work).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT")
      return undefined;
    throw error;
  });
  if (info === undefined) return;
  if (!info.isDirectory() || (await realpath(work)) !== work)
    throw new Error("Invalid PDF inspection cleanup path");
  if (process.platform === "linux") {
    const mountPoints = (await readFile("/proc/self/mountinfo", "utf8"))
      .split("\n")
      .map((row) =>
        row
          .split(" ")[4]
          ?.replace(/\\([0-7]{3})/g, (_, digits: string) =>
            String.fromCharCode(parseInt(digits, 8)),
          ),
      );
    if (
      mountPoints.some((path) => path === work || path?.startsWith(work + "/"))
    )
      throw new Error("Unexpected PDF inspection mount");
  }
  await rm(work, { recursive: true, force: true });
}

export async function recoverPdfInspections(
  db: RendererDatabase,
  config: WorkerConfig,
) {
  db.pdfInspections.prune(nowIso());
  for (const stale of db.pdfInspections.stale(nowIso())) {
    const owner = `${config.workerId}:pdf-inspection-recovery`;
    if (
      !db.transaction(() =>
        db.pdfInspections.takeRecovery(stale, owner, nowIso()),
      )
    )
      continue;
    try {
      await dockerStopVerified(
        rendererContainerName(stale.id, 0, "inspection"),
      );
      await cleanup(config, stale.id);
      db.pdfInspections.finish(stale.id, owner, {
        error: "PDF_INSPECTION_INTERRUPTED",
      });
    } catch {
      config.diagnostic?.({
        event: "renderer_worker.pdf_inspection_recovery_deferred",
        jobId: stale.job_id,
      });
    }
  }
}

export async function processPdfInspection(
  db: RendererDatabase,
  config: WorkerConfig,
  request: PdfInspectionRow,
) {
  const work = paths(config, request.id),
    maxOutputBytes = Math.min(config.maxOutputBytes, 4 * 1024 * 1024);
  const policy = { retentionHours: config.artifactRetentionHours ?? 24 };
  const currentPdf = () =>
    db.artifacts.getDownloadable(request.job_id, "result.pdf", policy);
  let lost = false,
    release: (() => void) | undefined;
  const owns = () =>
    !lost && db.pdfInspections.owns(request.id, config.workerId, nowIso());
  let outcome: { json: string } | { error: string };
  try {
    const { artifact, lease } = db.transaction(() => {
      const artifact = currentPdf();
      if (
        !artifact ||
        artifact.id !== request.artifact_id ||
        artifact.sha256 !== request.pdf_sha256 ||
        !owns()
      )
        throw new AppError(
          "PDF_UNAVAILABLE",
          "The canonical PDF has expired or changed",
          410,
        );
      const lease = newId("inspection_download");
      db.artifacts.createLease({
        id: lease,
        jobId: request.job_id,
        artifactId: artifact.id,
        createdAt: nowIso(),
        expiresAt: new Date(
          Date.now() + ARTIFACT_DOWNLOAD_LEASE_MS,
        ).toISOString(),
      });
      return { artifact, lease };
    });
    release = protectArtifactDownloadLeases(db.artifacts, [lease], () => {
      lost = true;
    });
    const path = artifactStoragePath(config.storageRoot, artifact);
    if (
      (await realpath(path)) !== path ||
      (await readArtifactSinglePass(path, "pdf", await lstat(path))).sha256 !==
        artifact.sha256
    )
      throw new AppError("PDF_CHECKSUM_MISMATCH", "Stored PDF changed", 409);
    const space = await statfs(config.storageRoot);
    if (
      space.bavail * space.bsize <
      (config.minFreeStorageBytes ?? 5 * 1024 ** 3) + maxOutputBytes
    )
      throw new AppError(
        "INSUFFICIENT_STORAGE",
        "No PDF inspection working space",
        503,
      );
    await mkdir(work.input, { recursive: true, mode: 0o770 });
    await mkdir(work.output, { recursive: false, mode: 0o770 });
    if (!owns()) throw new Error("Inspection lease lost");
    const crop =
      request.crop_json === null
        ? null
        : pdfCropRequestSchema.parse(JSON.parse(request.crop_json));
    const result = await runRendererStage(
      db,
      { ...config, maxOutputBytes },
      { id: request.id, lease_generation: 0, entrypoint: "main.tex" },
      work.input,
      work.output,
      {
        mode: "inspection",
        pdfDirectory: dirname(path),
        inspectionScript: crop === null ? inspect : pdfCropProgram(crop),
      },
      50_000,
      { owns },
    );
    if (result.timedOut || result.exitCode !== 0 || !owns())
      throw new AppError(
        "PDF_INSPECTION_FAILED",
        "PDF inspection did not finish",
        409,
      );
    const checks =
      crop !== null
        ? null
        : Object.fromEntries(
            await Promise.all(
              (Object.keys(resultLimits) as ResultName[]).map(
                async (key) =>
                  [key, await outputText(work.output, key)] as const,
              ),
            ),
          );
    const json = JSON.stringify(
      crop === null
        ? {
            version: request.inspector_version,
            runtimeImage: config.image,
            checks,
            visual: "not_checked",
            sourceComparison: "not_checked",
          }
        : await readPdfCrop(work.output, crop),
    );
    if (Buffer.byteLength(json) > 65_536)
      throw new AppError(
        "PDF_INSPECTION_OUTPUT_LIMIT",
        "PDF inspection output exceeded its limit",
        409,
      );
    outcome = { json };
  } catch (error) {
    if (error instanceof RendererCleanupDeferred) throw error;
    outcome = {
      error: error instanceof AppError ? error.code : "PDF_INSPECTION_FAILED",
    };
  } finally {
    release?.();
  }
  try {
    await cleanup(config, request.id);
  } catch (error) {
    throw new RendererCleanupDeferred(
      "PDF inspection cleanup could not be verified",
      { cause: error },
    );
  }
  db.pdfInspections.finish(request.id, config.workerId, outcome);
}
