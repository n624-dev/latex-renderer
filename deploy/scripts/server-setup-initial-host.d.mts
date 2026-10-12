import type {
  ServerSetupSessionHost,
  ServerSetupReview,
  ServerInitialCredentials,
  ServerIngressCredentials,
} from "../../packages/server-setup-core/src/index.mjs";
export function controlledServerSetupRelease(): Promise<string>;
export function inspectInitialSetupDatabase(
  path: string,
  id: string,
  identity: { uid: number; gid: number },
  journal: {
    id: string;
    kind: "initial" | "ingress";
    phase: "pending" | "owner-ready" | "committed";
  } | null,
): Promise<"none" | "ours" | "foreign">;
export function serverSetupIngressCheckArgs(): string[];
export function prepareServerSetupDirectory(
  path: string,
  gid: number,
  mode: number,
  uid?: number,
): Promise<void>;
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
