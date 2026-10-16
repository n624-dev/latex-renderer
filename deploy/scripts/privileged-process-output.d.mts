import type { ChildProcessByStdio } from "node:child_process";
import type { Writable, Readable } from "node:stream";
export function waitPrivilegedProcess(
  child: ChildProcessByStdio<Writable, Readable, Readable>,
  append: (chunk: string) => Promise<void>,
): Promise<{ code: number | null; stderr: string; logError: unknown }>;
