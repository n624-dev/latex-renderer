import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RendererDatabase, WorkerJobRow } from "@latex-renderer/database";
import { newId, nowIso } from "@latex-renderer/shared";
import { publishArtifacts, validateArtifacts } from "./artifact-validator.js";
import type { WorkerConfig } from "./config.js";

export async function recordFailure(
  database: RendererDatabase,
  config: WorkerConfig,
  job: WorkerJobRow,
  message: string,
  errorCode: string,
  status: "rejected" | "failed",
): Promise<void> {
  const jobId = job.id;
  const root = join(config.storageRoot, "jobs", jobId),
    failureRoot = join(root, "attempts", `${job.lease_generation}-failure`),
    staging = join(failureRoot, "staging"),
    candidateOutput = join(failureRoot, "output"),
    output = join(root, "output");
  const renewLease = (): boolean =>
    database.worker.heartbeat(
      job.id,
      config.workerId,
      job.lease_generation,
      nowIso(),
      new Date(Date.now() + 30_000).toISOString(),
    ) === 1;
  if (!renewLease()) return;
  await rm(failureRoot, { recursive: true, force: true });
  try {
    // prepare-host.sh installs a default ACL for the rootless renderer mapping;
    // do not fall back to a world-writable staging directory on failure paths.
    await mkdir(staging, { recursive: true, mode: 0o770 });
    await chmod(staging, 0o770);
    /* eslint-disable no-control-regex -- strip terminal controls from hostile parser errors. */
    const controlCharacters =
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u009b]/g;
    /* eslint-enable no-control-regex */
    const safeMessage = message.replace(controlCharacters, "");
    await writeFile(join(staging, "compile.log"), `${safeMessage}\n`, {
      mode: 0o660,
    });
    await writeFile(
      join(staging, "errors.json"),
      `${JSON.stringify({ success: false, exitCode: null, errors: [{ file: "main.tex", line: null, message: safeMessage }], warnings: [] }, null, 2)}\n`,
      { mode: 0o660 },
    );
    await writeFile(
      join(staging, "dependencies.json"),
      '{"inputs":[],"outputs":[]}\n',
      { mode: 0o660 },
    );
    const artifacts = await validateArtifacts(config, staging, false);
    await publishArtifacts(staging, candidateOutput, artifacts);
    if (!renewLease()) return;
    await rm(output, { recursive: true, force: true });
    await rename(candidateOutput, output);
    database.transaction(() => {
      const timestamp = nowIso();
      const total = artifacts.reduce((sum, artifact) => sum + artifact.size, 0);
      if (
        database.worker.finishFailure(
          jobId,
          status,
          errorCode,
          safeMessage,
          timestamp,
          total,
          config.workerId,
          job.lease_generation,
        ) !== 1
      )
        return false;
      for (const artifact of artifacts)
        database.artifacts.insert({
          id: newId("artifact"),
          job_id: jobId,
          type: artifact.type,
          relative_path: artifact.path,
          size: artifact.size,
          sha256: artifact.sha256,
          created_at: timestamp,
        });
      database.audit({
        actorType: "system",
        actorId: config.workerId,
        action: "render.failed",
        targetType: "job",
        targetId: jobId,
        result: status,
        metadata: { message: safeMessage },
      });
    });
  } finally {
    await rm(failureRoot, { recursive: true, force: true });
  }
}
