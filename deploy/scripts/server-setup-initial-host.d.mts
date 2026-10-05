import type {
  ServerSetupSessionHost,
  ServerSetupReview,
  ServerInitialCredentials,
  ServerIngressCredentials,
} from "../../packages/server-setup-core/src/index.mjs";
export function controlledServerSetupRelease(): Promise<string>;
export function createInitialServerSetupHost(
  kind?: "initial" | "ingress" | "auto",
): Promise<
  ServerSetupSessionHost & {
    current(): Promise<ServerSetupReview>;
    apply(
      envelope: unknown,
      credentials: ServerInitialCredentials | ServerIngressCredentials,
    ): Promise<{ installed: true }>;
    recover(beforeStart?: boolean): Promise<{
      recovered: boolean;
      committed?: boolean;
      awaitingCredentials?: boolean;
      pendingHealth?: boolean;
    }>;
  }
>;
