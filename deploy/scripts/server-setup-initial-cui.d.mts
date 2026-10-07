import type { ServerSetupSessionHost } from "../../packages/server-setup-core/src/index.mjs";
export function runServerInitialCui(
  host: ServerSetupSessionHost,
  io: {
    ask(prompt: string): Promise<string>;
    askSecret(prompt: string): Promise<string>;
    print(message: string): void;
    readFile(path: string, maximum: number): Promise<string>;
  },
): Promise<{ applied: boolean }>;
