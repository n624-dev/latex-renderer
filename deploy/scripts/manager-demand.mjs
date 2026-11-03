import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { join } from "node:path";

async function record(path) {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.uid !== process.getuid() ||
      info.mode & 0o022 ||
      info.size > 1024 * 1024 ||
      (await realpath(path)) !== path
    )
      throw new Error("Unsafe Manager operation state");
    return JSON.parse(await file.readFile("utf8"));
  } finally {
    await file.close();
  }
}
export async function imageManagerNeedsRecovery(
  root = "/var/lib/latex-renderer/image-manager",
) {
  try {
    const journal = await record(join(root, "activation-journal.json"));
    if (
      journal?.version !== 1 ||
      typeof journal.oldEnv !== "string" ||
      typeof journal.newImageId !== "string"
    )
      throw new Error("Corrupt image activation journal");
    return true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const state = await record(join(root, "state.json"));
  if (
    state?.version !== 1 ||
    !state.desired ||
    typeof state.desired !== "object"
  )
    throw new Error("Corrupt Image Manager state");
  if (state.lastOperationId === null || state.lastOperationId === undefined)
    return false;
  if (
    typeof state.lastOperationId !== "string" ||
    !/^imgop_[0-9]{13}_[a-z0-9]{1,16}$/.test(state.lastOperationId)
  )
    throw new Error("Invalid image operation identity");
  const operation = await record(
    join(root, "operations", `${state.lastOperationId}.json`),
  );
  if (
    operation.id !== state.lastOperationId ||
    !["running", "succeeded", "failed"].includes(operation.status)
  )
    throw new Error("Corrupt image operation record");
  return operation.status === "running";
}
