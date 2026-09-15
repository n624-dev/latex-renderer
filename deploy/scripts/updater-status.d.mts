import type { UpdaterSlots, UpdaterEnvelope } from "./updater-slots.mjs";
export interface UpdaterIdentity {
  version: string;
  commit: string;
  slotId: string;
}
export interface UpdaterStatus {
  status: string;
  running: UpdaterIdentity | null;
  selectedSlotId: string | null;
  candidateSlotId: string | null;
  pending: boolean;
}
export function expectedUpdater(envelope: UpdaterEnvelope): UpdaterIdentity;
export function readExpectedUpdater(source: string): Promise<UpdaterIdentity>;
export function updaterStatus(options?: {
  slots?: UpdaterSlots;
  runningRoot?: string;
}): Promise<UpdaterStatus>;
export function updateOutcome(
  operation: {
    status: string;
    type: string;
    finishedAt?: string | null;
    expectedUpdater?: UpdaterIdentity | null;
  },
  updater: UpdaterStatus,
  now?: number,
): { application: string; updater: string; complete: boolean };
