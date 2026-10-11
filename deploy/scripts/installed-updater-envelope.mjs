import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { updaterEnvelope } from "./updater-slots.mjs";

// A staged modern release already declares its complete independently hashed
// controller. The historical minimal selection is only for releases without
// that metadata; using it for modern code omits required controller imports.
export async function installedUpdaterEnvelope(source, manifest) {
  let bytes;
  try {
    bytes = await readFile(
      join(source, ".latex-renderer-updater.json"),
      "utf8",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return updaterEnvelope(source, manifest, true);
  }
  const envelope = JSON.parse(bytes);
  if (
    envelope.version !== manifest.version ||
    envelope.commit !== manifest.commit
  )
    throw new Error("Installed Updater envelope differs from release metadata");
  return envelope; // UpdaterSlots.stage verifies the full envelope and payload.
}
