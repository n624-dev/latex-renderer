import type { DatabaseSync } from "node:sqlite";
export function collectSourceTrees(
  db: DatabaseSync,
  storageRoot: string,
  pressure?: boolean,
  maximum?: number,
  maximumBytes?: number,
  maximumUserBytes?: number,
): Promise<void>;
