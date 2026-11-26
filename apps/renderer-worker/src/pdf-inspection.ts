import { readPdfSheet, sheetProgram } from "./pdf-sheet.js";
import { readSyncResult, syncArguments, syncProgram } from "./pdf-sync.js";
import {
  documentProbeSchema,
  pdfInspectionInputSchema,
  type DocumentProbe,
} from "@latex-renderer/contracts";
import { pdfCropProgram, readPdfCrop } from "./pdf-crop.js";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  statfs,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ARTIFACT_DOWNLOAD_LEASE_MS,
  artifactStoragePath,
  pdfInspectionUploadDirectory,
  pdfInspectionUploadResult,
  protectArtifactDownloadLeases,
  type PdfInspectionRow,
  type ArtifactRow,
  type DocumentProbeRow,
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
printf "%s\n" fixed-long-edge-512-ppm-v1 > versions
qpdf --version >> versions
pdftoppm -v >> versions 2>&1
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
# Fixed-size samples are comparable only with the same rasterizer version.
# Render at most 12 physical pages on explicit request. Never mark later
# pages or details finer than this sampling resolution as compared.
if timeout -k 2 12 pdftoppm -f 1 -l 12 -cropbox -scale-to 512 "$pdf" /tmp/final-page; then
  for raster in /tmp/final-page-*.ppm; do
    [ -f "$raster" ] || break
    sha256sum "$raster" | cut -d ' ' -f 1
  done > page-rasters
fi
`;

const resultLimits = {
  versions: 512,
  structure: 100,
  "page-info": 12_000,
  "font-info": 8_000,
  "extracted-text": 8_000,
  navigation: 12_000,
  "page-rasters": 2048,
} as const;

type ResultName = keyof typeof resultLimits;

function paths(config: WorkerConfig, id: string) {
  if (!/^(?:inspect|probe)_[a-f0-9]{32}$/.test(id))
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

async function removeInspectionDirectory(work: string) {
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

function cleanup(config: WorkerConfig, id: string) {
  return removeInspectionDirectory(paths(config, id).work);
}

export async function recoverPdfInspections(
  db: RendererDatabase,
  config: WorkerConfig,
) {
  const timestamp = nowIso();
  for (const upload of db.pdfInspections.expiredUploads(timestamp)) {
    try {
      await removeInspectionDirectory(
        pdfInspectionUploadDirectory(config.storageRoot, upload.id),
      );
      db.pdfInspections.deleteExpiredUpload(upload.id, timestamp);
    } catch {
      config.diagnostic?.({
        event: "renderer_worker.pdf_upload_cleanup_deferred",
      });
    }
  }
  db.pdfInspections.prune(timestamp);
  db.documentProbes.prune(timestamp);
  const probe = db.documentProbes.running();
  const recoverer = `${config.workerId}:document-probe-recovery`;
  if (
    probe?.lease_until &&
    probe.lease_until <= timestamp &&
    db.documentProbes.claimRecovery(probe, recoverer, timestamp)
  ) {
    try {
      await dockerStopVerified(rendererContainerName(probe.id, 0));
      await cleanup(config, probe.id);
      db.documentProbes.finish(
        probe.id,
        recoverer,
        "DOCUMENT_PROBE_INTERRUPTED",
        "failed",
      );
    } catch {
      config.diagnostic?.({
        event: "renderer_worker.document_probe_recovery_deferred",
      });
    }
  }
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
  const jobId = request.job_id;
  let lost = false,
    release: (() => void) | undefined;
  const owns = () =>
    !lost && db.pdfInspections.owns(request.id, config.workerId, nowIso());
  let outcome: { json: string } | { uploaded: true } | { error: string };
  try {
    const upload = request.upload_id
      ? db.pdfInspections.upload(request.upload_id)
      : undefined;
    let path: string;
    let size: number;
    let artifact: ArtifactRow | undefined;
    if (jobId === null) {
      if (
        !upload ||
        upload.pdf_sha256 !== request.pdf_sha256 ||
        upload.size === null ||
        upload.expires_at <= nowIso() ||
        !owns()
      )
        throw new AppError(
          "PDF_UNAVAILABLE",
          "The attached PDF has expired or changed",
          410,
        );
      path = join(
        pdfInspectionUploadDirectory(config.storageRoot, upload.id),
        "original",
        "result.pdf",
      );
      size = upload.size;
    } else {
      const result = db.transaction(() => {
        const artifact = db.artifacts.getDownloadable(
          jobId,
          "result.pdf",
          policy,
        );
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
          jobId,
          artifactId: artifact.id,
          createdAt: nowIso(),
          expiresAt: new Date(
            Date.now() + ARTIFACT_DOWNLOAD_LEASE_MS,
          ).toISOString(),
        });
        return { artifact, lease };
      });
      artifact = result.artifact;
      release = protectArtifactDownloadLeases(
        db.artifacts,
        [result.lease],
        () => {
          lost = true;
        },
      );
      path = artifactStoragePath(config.storageRoot, artifact);
      size = artifact.size;
    }
    const info = await lstat(path);
    if (
      info.size !== size ||
      (await realpath(path)) !== path ||
      (await readArtifactSinglePass(path, "pdf", info)).sha256 !==
        request.pdf_sha256
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
    const params =
      request.params_json === null
        ? null
        : pdfInspectionInputSchema.parse(JSON.parse(request.params_json));
    const sync = params && "direction" in params ? params : null;
    const crop = params && "width" in params ? params : null;
    const sheet = params && "pages" in params ? params : null;
    const allowedPaths = new Set<string>();
    if (sync !== null) {
      if (jobId === null || artifact === undefined)
        throw new AppError(
          "SYNCTEX_UNAVAILABLE",
          "No source map for this PDF",
          410,
        );
      const job = db.jobs.get(jobId);
      const source = job?.source_id ? db.sources.get(job.source_id) : undefined;
      for (const sourcePath of source
        ? db.sources.paths(source)
        : (db.drafts.renderInput(jobId)?.files ?? []).map(({ path }) => path))
        allowedPaths.add(sourcePath);
      if (sync.direction === "source_to_pdf" && !allowedPaths.has(sync.path))
        throw new AppError(
          "SOURCE_FILE_NOT_FOUND",
          "Source file does not match this PDF",
          404,
        );
      const map = db.artifacts.sourceMap(artifact);
      const mapPath = join(dirname(path), "result.synctex.gz");
      if (map === undefined || map.size > 8 * 1024 ** 2 || map.size < 1)
        throw new AppError(
          "SYNCTEX_UNAVAILABLE",
          "No source map for this PDF",
          410,
        );
      const info = await lstat(mapPath);
      if (
        info.size !== map.size ||
        (await readArtifactSinglePass(mapPath, "synctex", info)).sha256 !==
          map.sha256
      )
        throw new AppError(
          "SYNCTEX_CHECKSUM_MISMATCH",
          "Stored SyncTeX map changed",
          409,
        );
    }
    const result = await runRendererStage(
      db,
      { ...config, maxOutputBytes },
      { id: request.id, lease_generation: 0, entrypoint: "main.tex" },
      work.input,
      work.output,
      {
        mode: "inspection",
        pdfDirectory: dirname(path),
        inspectionScript:
          sync !== null
            ? syncProgram
            : sheet !== null
              ? sheetProgram
              : crop === null
                ? inspect
                : pdfCropProgram(crop),
        ...(sheet === null
          ? {}
          : { inspectionArguments: sheet.pages.map(String) }),
        ...(sync === null ? {} : { inspectionArguments: syncArguments(sync) }),
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
      params !== null
        ? null
        : Object.fromEntries(
            await Promise.all(
              (Object.keys(resultLimits) as ResultName[]).map(
                async (key) =>
                  [key, await outputText(work.output, key)] as const,
              ),
            ),
          );
    const pageCount = checks?.["page-info"]?.text?.match(/^Pages:\s+([1-9]\d*)$/m)?.[1];
    const sampledPages = checks?.["page-rasters"]?.text?.split("\n")
      .filter((line) => /^[a-f0-9]{64}$/.test(line)).length ?? 0;
    const json = JSON.stringify(
      sync !== null
        ? await readSyncResult(work.output, sync, allowedPaths)
        : sheet !== null
          ? await readPdfSheet(work.output, sheet)
          : crop === null
            ? {
                version: request.inspector_version,
                runtimeImage: config.image,
                checks,
                coverage: {
                  totalPages: pageCount === undefined ? null : Number(pageCount),
                  pageDetailsThrough: pageCount === undefined ? null : Math.min(Number(pageCount), 100),
                  sampledPages,
                  maxSampleSidePixels: 512,
                },
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
    if (upload) {
      if (!owns() || upload.expires_at <= nowIso())
        throw new AppError(
          "PDF_UNAVAILABLE",
          "The attached PDF has expired",
          410,
        );
      const directory = pdfInspectionUploadDirectory(
        config.storageRoot,
        upload.id,
      );
      await writeFile(pdfInspectionUploadResult(directory, request.id), json, {
        flag: "wx",
        mode: 0o660,
      });
      outcome = { uploaded: true };
    } else outcome = { json };
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

export function documentProbeSource(input: DocumentProbe): string {
  const options = documentProbeSchema.parse(input);
  const preamble = [`\\documentclass{${options.documentClass}}`];
  const packages = new Set(options.packages);
  if (options.japanese) packages.add("luatexja");
  if (options.font)
    packages.add(options.japanese ? "luatexja-fontspec" : "fontspec");
  if (options.mathFont) packages.add("unicode-math");
  for (const pkg of packages) preamble.push(`\\usepackage{${pkg}}`);
  if (options.font)
    preamble.push(
      `\\${options.japanese ? "setmainjfont" : "setmainfont"}{${options.font}}`,
    );
  if (options.mathFont) preamble.push(`\\setmathfont{${options.mathFont}}`);
  return [
    ...preamble,
    "\\begin{document}",
    options.japanese
      ? "日本語の組版。 $x^2+1$"
      : "Document requirement sample. $x^2+1$",
    "\\end{document}",
    "",
  ].join("\n");
}

export async function processDocumentProbe(
  db: RendererDatabase,
  config: WorkerConfig,
  request: DocumentProbeRow,
) {
  const work = paths(config, request.id);
  const owns = () =>
    db.documentProbes.owns(request.id, config.workerId, nowIso());
  let code = "DOCUMENT_PROBE_FAILED";
  let status: "ready" | "failed" = "failed";
  try {
    if (request.runtime_image !== config.image)
      throw new AppError(
        "DOCUMENT_PROBE_RUNTIME_CHANGED",
        "The active Runtime changed",
        409,
      );
    const input = documentProbeSchema.parse(JSON.parse(request.input_json));
    const maxOutputBytes = Math.min(config.maxOutputBytes, 4 * 1024 * 1024);
    const space = await statfs(config.storageRoot);
    if (
      space.bavail * space.bsize <
      (config.minFreeStorageBytes ?? 5 * 1024 ** 3) + maxOutputBytes
    )
      throw new AppError(
        "INSUFFICIENT_STORAGE",
        "No document probe working space",
        503,
      );
    await mkdir(work.input, { recursive: true, mode: 0o770 });
    await mkdir(work.output, { mode: 0o770 });
    await writeFile(join(work.input, "main.tex"), documentProbeSource(input), {
      flag: "wx",
      mode: 0o640,
    });
    if (!owns()) throw new Error("Document probe lease lost");
    const execution = await runRendererStage(
      db,
      { ...config, maxOutputBytes },
      {
        id: request.id,
        lease_generation: 0,
        entrypoint: "main.tex",
        engine: input.engine,
      },
      work.input,
      work.output,
      { mode: "pdf", outputs: ["pdf"], deferFirstPreview: true },
      30_000,
      { owns },
    );
    if (!owns()) throw new Error("Document probe lease lost");
    if (execution.timedOut)
      throw new AppError(
        "DOCUMENT_PROBE_TIMEOUT",
        "Document probe timed out",
        409,
      );
    if (execution.exitCode !== 0)
      throw new AppError(
        "DOCUMENT_PROBE_DID_NOT_COMPILE",
        "The requested combination did not compile",
        409,
      );
    const pdf = join(work.output, "result.pdf");
    await readArtifactSinglePass(pdf, "pdf", await lstat(pdf));
    code = "DOCUMENT_PROBE_COMPILED";
    status = "ready";
  } catch (error) {
    if (error instanceof RendererCleanupDeferred) throw error;
    if (error instanceof AppError) code = error.code;
  }
  try {
    await cleanup(config, request.id);
  } catch (error) {
    throw new RendererCleanupDeferred(
      "Document probe cleanup could not be verified",
      { cause: error },
    );
  }
  db.documentProbes.finish(request.id, config.workerId, code, status);
}
