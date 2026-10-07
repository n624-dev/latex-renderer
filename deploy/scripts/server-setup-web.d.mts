import type { ServerSetupSessionHost } from "../../packages/server-setup-core/src/index.mjs";
export function startServerSetupWeb(
  host: ServerSetupSessionHost,
  options?: {
    lifetimeMs?: number;
    idleMs?: number;
    listenAddress?: string;
    allowedNetworks?: string[];
    acknowledgePlaintextLan?: boolean;
    interfaces?: ReturnType<typeof import("node:os").networkInterfaces>;
  },
): Promise<
  Readonly<{
    origin: string;
    bootstrapUrl: string;
    close(): void;
    closed: Promise<void>;
  }>
>;
