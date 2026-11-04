export type SdkDirectoryState = "missing" | "unsafe" | "mounted" | "directory";
export interface UpdateHostDiskReport {
  event: string;
  beforeBytes: number;
  availableBytes: number;
  minimumBytes: number;
  targetBytes: number;
  removedSdkDirectories: string[];
}
export interface UpdateHostDiskOptions {
  uid?: number;
  environment?: Record<string, string | undefined>;
  scriptPath?: string;
  exists?: (path: string) => boolean;
  inspect?: (path: string) => SdkDirectoryState;
  available?: () => number;
  remove?: (path: string) => unknown;
  log?: (report: UpdateHostDiskReport) => void;
}
export const UPDATE_HOST_MINIMUM_BYTES: number;
export const UPDATE_HOST_TARGET_BYTES: number;
export function inspectSdkDirectory(path: string): SdkDirectoryState;
export function prepareUpdateHostDisk(
  options?: UpdateHostDiskOptions,
): UpdateHostDiskReport;
