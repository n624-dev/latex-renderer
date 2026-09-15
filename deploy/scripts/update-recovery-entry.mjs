// Root-only host shim; resolve the independently verified Updater, not the
// mutable application pointer. Old slots can lack recovery support during an
// initial migration or rollback; periodic GC then defers without deleting data.
import { UpdaterSlots } from "/opt/latex-renderer/updater/bootstrap-v1/updater-slots.mjs";
if (process.getuid() !== 0) throw new Error("Recovery entry requires root");
const args = process.argv.slice(2);
if (
  !(args.length === 1 && ["gc", "status", "create"].includes(args[0])) &&
  !(
    args.length === 2 &&
    args[0] === "acknowledge" &&
    /^rp-[0-9]{13}-[a-f0-9]{12}$/.test(args[1])
  )
)
  throw new Error("Invalid recovery command");
const slots = new UpdaterSlots("/opt/latex-renderer/updater", 0);
const { root, envelope } = await slots.verify((await slots.state()).current);
const path = "deploy/scripts/update-recovery-host.mjs";
if (!envelope.files[path]) {
  if (args[0] !== "gc")
    throw new Error("Install an Updater with recovery-point support first");
  console.log(
    "Recovery GC deferred: active Updater does not support managed recovery points",
  );
} else {
  process.execve(
    "/usr/local/bin/node",
    ["/usr/local/bin/node", `${root}/${path}`, ...args],
    process.env,
  );
}
