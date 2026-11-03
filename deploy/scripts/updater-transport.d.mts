export function updaterSocketCapable(root: string): Promise<boolean>;
export function prepareUpdaterTransport(options: {
  slots: {
    state(): Promise<{ current: string }>;
    verify(id: string): Promise<{ root: string }>;
  };
  action?: "prepare" | "check" | "resume";
  compact?: boolean;
  run?: (...args: string[]) => unknown;
}): Promise<{ activated: boolean }>;
