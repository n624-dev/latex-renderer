import type { FileHandle } from "node:fs/promises";

export class DurableFileBatch {
  constructor(limit?: number);
  add(handle: Pick<FileHandle, "sync" | "close">): Promise<void>;
  flush(): Promise<void>;
  discard(): Promise<void>;
}
