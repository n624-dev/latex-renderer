import type { LanHttpsClientConfiguration } from "./configuration.mjs";
import type { LanHttpsClientState } from "./client-state.mjs";
export function lanHttpsProfileId(provider: unknown, issuerId: string): string;
export function withLanHttpsProfile<T>(
  config: LanHttpsClientConfiguration,
  action: (context: {
    rootState: LanHttpsClientState;
    state: LanHttpsClientState;
    profileRoot: string;
    groupState: LanHttpsClientState;
    id: string;
    installationId: string;
  }) => T | Promise<T>,
  options?: { allowAccountRotation?: boolean },
): Promise<T>;

export function withExistingLanHttpsProfile<T>(
  config: LanHttpsClientConfiguration,
  action: (context: {
    state: LanHttpsClientState;
    profileRoot: string;
    id: string;
  }) => T | Promise<T>,
): Promise<T>;
