// Real process/crash fixture. Only this child patches the filesystem binding.
import filesystem from "node:fs/promises";
import process from "node:process";
import { syncBuiltinESMExports } from "node:module";
import { basename, dirname, join } from "node:path";

const [output, pauseAt] = process.argv.slice(2);
const canonicalOutput = join(
  await filesystem.realpath(dirname(output)),
  basename(output),
);
const originalRename = filesystem.rename;
const stop = async (phase) => {
  if (phase !== pauseAt) return;
  process.send({ phase });
  await new Promise(() => {});
};
filesystem.rename = async (from, to) => {
  await originalRename(from, to);
  if (basename(to) === "backup") await stop("backup");
  if (to === canonicalOutput && basename(from) === "stage")
    await stop("published");
  if (basename(to) === "committed.json") await stop("committed");
  if (basename(to).startsWith("gc-")) await stop("cleanup");
};
syncBuiltinESMExports();
const { publishArtifactSet } =
  await import("../../packages/client-core/src/artifact-transaction.ts");
try {
  await publishArtifactSet(output, async (stage) => {
    await filesystem.writeFile(join(stage, "result.pdf"), "new-pdf");
    await filesystem.writeFile(join(stage, "job.json"), "new-job");
    await stop("staging");
  });
  process.send({ phase: "finished" });
} catch (error) {
  process.send({ phase: "failed", code: error.code, message: error.message });
  process.exitCode = 1;
} finally {
  process.disconnect();
}
