export function diagnosticWriter(
  storageRoot: string,
  channel: "remote-mcp" | "renderer-worker",
  now?: () => number,
): ((record: Readonly<Record<string, unknown>>) => void) & {
  flush(): Promise<void>;
};
export function pruneServiceDiagnostics(
  storageRoot: string,
  now?: number,
): Promise<number>;
