import type { ServerSetupSessionHost } from "../../packages/server-setup-core/src/index.mjs";
export function runServerSetupCui(
  host: ServerSetupSessionHost,
  io: {
    ask(this: void, prompt: string): Promise<string>;
    print(this: void, message: string): void;
  },
): Promise<{ applied: boolean }>;
