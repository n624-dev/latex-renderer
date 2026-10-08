export function runServerSetupChild(
  command: string,
  args: string[],
  input: string,
  options: {
    timeoutMs: number;
    maxOutputBytes?: number;
    killGraceMs?: number;
  },
): Promise<string>;
