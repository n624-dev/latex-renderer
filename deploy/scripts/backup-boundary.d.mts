import type { DatabaseSync } from "node:sqlite";

export function projectSourceRows(database: DatabaseSync): Array<{
  id: string;
  storage_key: string;
  size: number;
  sha256: string;
}>;
