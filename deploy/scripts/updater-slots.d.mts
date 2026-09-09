export interface UpdaterEnvelope {
  schemaVersion: number;
  requiredNodeMajor: number;
  version: string;
  commit: string;
  files: Record<string, { sha256: string; bytes: number }>;
}
export interface UpdaterState {
  schemaVersion: 1;
  current: string;
  previous: string | null;
  candidate: string | null;
  pending: { from: string; previous: string | null } | null;
}
export const UPDATER_FILES: readonly string[];
export function recoverPendingUpdater(
  slots: UpdaterSlots,
  acquireLock: () => Promise<{ release(): Promise<void> }>,
  restore: () => Promise<unknown>,
): Promise<boolean>;
export function updaterEnvelope(
  source: string,
  identity: { version: string; commit: string },
  legacy?: boolean,
): Promise<UpdaterEnvelope>;
export class UpdaterSlots {
  root: string;
  uid: number;
  constructor(root: string, uid?: number);
  initialize(): Promise<void>;
  atomic(path: string, data: string | Buffer, mode?: number): Promise<void>;
  state(): Promise<UpdaterState>;
  save(state: UpdaterState): Promise<void>;
  verify(id: string): Promise<{ root: string; envelope: UpdaterEnvelope }>;
  stage(source: string, envelope: UpdaterEnvelope): Promise<string>;
  nominate(id: string): Promise<void>;
  begin(): Promise<boolean>;
  finish(): Promise<void>;
  recover(): Promise<boolean>;
  collect(): Promise<void>;
}
