import type { ServerSetupSessionHost } from "../../packages/server-setup-core/src/index.mjs";
export function startServerSetupWeb(
  host: ServerSetupSessionHost,
  options?: { lifetimeMs?: number; idleMs?: number },
): Promise<
  Readonly<{
    origin: string;
    bootstrapUrl: string;
    close(): void;
    closed: Promise<void>;
  }>
>;
