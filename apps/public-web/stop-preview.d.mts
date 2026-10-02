import type { ChildProcess } from "node:child_process";

export function stopPreview(
  worker: ChildProcess,
  exited: Promise<unknown>,
  timeout?: number,
): Promise<void>;
