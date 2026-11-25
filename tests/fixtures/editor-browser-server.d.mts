export function startEditorBrowserFixture(options?: {
  saveConflict?: boolean;
  renderFailure?: boolean;
  onRequest?(event: {
    method: string;
    path: string;
    status: number;
    elapsedMs: number;
  }): void;
}): Promise<{
  origin: string;
  editorPath: string;
  state: Readonly<{ text: string; version: number }>;
  close(): Promise<void>;
}>;
