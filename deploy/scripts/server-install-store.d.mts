import type {
  InstallationFiles,
  InstallationJournal,
  InstallationStore,
} from "./server-install-transaction.mjs";
import type { ServerSetupReview } from "../../packages/server-setup-core/src/index.mjs";
export interface InstallationSlot {
  path: string;
  mode: number;
  maximum: number;
  gid: number;
}
export class ServerInstallStore implements InstallationStore {
  constructor(
    root: string,
    slots: Record<string, InstallationSlot>,
    uid?: number,
  );
  slot(name: string): InstallationSlot;
  read(slot: InstallationSlot): Promise<string | null>;
  write(slot: InstallationSlot, contents: string | null): Promise<void>;
  journal(): Promise<InstallationJournal | null>;
  saveJournal(value: InstallationJournal): Promise<void>;
  clear(): Promise<void>;
  snapshot(candidate: ServerSetupReview): Promise<InstallationFiles>;
  snapshotFiles(entries: InstallationFiles): Promise<InstallationFiles>;
  replace(entries: InstallationFiles): Promise<void>;
  assertCompatible(journal: InstallationJournal): Promise<void>;
}
