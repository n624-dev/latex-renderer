import type { UpdaterEnvelope } from "./updater-slots.mjs";

export function installedUpdaterEnvelope(
  source: string,
  manifest: { version: string; commit: string },
): Promise<UpdaterEnvelope>;
