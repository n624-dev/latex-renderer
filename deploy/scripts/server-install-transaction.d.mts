import type { ServerSetupReview } from "../../packages/server-setup-core/src/index.mjs";
export type InstallationFiles = Record<string, string | null>;
export interface InstallationJournal {
  format: 1;
  kind: "initial" | "ingress";
  id: string;
  phase: "pending" | "owner-ready" | "committed";
  before: InstallationFiles;
  after: InstallationFiles;
  units: string[];
}
export interface InstallationStore {
  journal(): Promise<InstallationJournal | null>;
  snapshot(candidate: ServerSetupReview): Promise<InstallationFiles>;
  snapshotFiles(entries: InstallationFiles): Promise<InstallationFiles>;
  assertCompatible(journal: InstallationJournal): Promise<void>;
  replace(entries: InstallationFiles): Promise<void>;
  saveJournal(value: InstallationJournal): Promise<void>;
  clear(): Promise<void>;
}
export interface InstallationHost {
  kind?: "initial" | "ingress";
  preflight(
    this: void,
    candidate: ServerSetupReview,
  ): unknown | Promise<unknown>;
  validateCredentials(
    this: void,
    candidate: ServerSetupReview,
    credentials: unknown,
  ): unknown | Promise<unknown>;
  files(
    this: void,
    candidate: ServerSetupReview,
    credentials: unknown,
  ): InstallationFiles | Promise<InstallationFiles>;
  units(this: void, candidate: ServerSetupReview): string[];
  active(this: void, unit: string): boolean | Promise<boolean>;
  stop(this: void, unit: string): unknown | Promise<unknown>;
  start(this: void, unit: string): unknown | Promise<unknown>;
  ownerState(
    this: void,
    id: string,
  ): "none" | "ours" | "foreign" | Promise<"none" | "ours" | "foreign">;
  ensureSecrets(
    this: void,
    candidate: ServerSetupReview,
    credentials: unknown,
  ): unknown | Promise<unknown>;
  createOwner(
    this: void,
    id: string,
    candidate: ServerSetupReview,
    credentials: unknown,
  ): unknown | Promise<unknown>;
  validatePublished(
    this: void,
    files: InstallationFiles,
    beforeStart?: boolean,
  ): unknown | Promise<unknown>;
  health(this: void, files: InstallationFiles): unknown | Promise<unknown>;
  finalize?(this: void, units: string[]): unknown | Promise<unknown>;
}
export function validateInstallationJournal(
  value: unknown,
): InstallationJournal;
export function reviewInstallation(
  store: InstallationStore,
  host: InstallationHost,
  candidate: ServerSetupReview,
): Promise<{ candidate: ServerSetupReview; baseSha256: string }>;
export function applyInstallation(
  store: InstallationStore,
  host: InstallationHost,
  envelope: unknown,
  credentials: unknown,
): Promise<{ installed: true }>;
export function recoverInstallation(
  store: InstallationStore,
  host: InstallationHost,
  beforeStart?: boolean,
): Promise<{
  recovered: boolean;
  committed?: boolean;
  rolledBack?: boolean;
  awaitingCredentials?: boolean;
  pendingHealth?: boolean;
}>;
