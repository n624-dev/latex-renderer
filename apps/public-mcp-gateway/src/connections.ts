import {
  isRendererMcpScope,
  type RendererMcpScope,
} from "@latex-renderer/contracts";

export interface InstanceIdentity {
  id: string;
  publicKey: string;
}

export interface ConnectionProfile {
  id: string;
  instanceId: string;
  localProfileId: string;
  displayName: string | null;
}

export type TransportEndpoint =
  { kind: "https"; mcpUrl: string } | { kind: "agent"; publicKey: string };

export interface ConnectionTransport {
  id: string;
  instanceId: string;
  endpoint: TransportEndpoint;
  disabledAt: number | null;
}

export interface ConnectionAuthorization {
  id: string;
  profileId: string;
  instanceId: string;
  transportId: string;
  localGrantId: string;
  scopes: readonly RendererMcpScope[];
  expiresAt: number;
  reauthRequired: boolean;
  revokedAt: number | null;
}

export type NewAuthorization = Pick<
  ConnectionAuthorization,
  "profileId" | "transportId" | "localGrantId" | "scopes" | "expiresAt"
>;

export function isActiveAuthorization(
  authorization: ConnectionAuthorization,
  now: number,
): boolean {
  return (
    authorization.revokedAt === null &&
    !authorization.reauthRequired &&
    authorization.expiresAt > now
  );
}

export function decodeStoredScopes(json: string): RendererMcpScope[] {
  const decoded: unknown = JSON.parse(json);
  if (
    !Array.isArray(decoded) ||
    decoded.length === 0 ||
    !decoded.every(
      (scope): scope is RendererMcpScope =>
        typeof scope === "string" && isRendererMcpScope(scope),
    )
  )
    throw new Error("Stored public MCP authorization scope is invalid");
  return decoded;
}

/** Store operations receive identities verified by the OAuth or pairing layer. */
export interface ConnectionStore {
  putVerifiedInstance(instance: InstanceIdentity): void;
  profileFor(
    instanceId: string,
    localProfileId: string,
    displayName?: string,
  ): ConnectionProfile;
  profile(id: string): ConnectionProfile | undefined;
  addTransport(
    instanceId: string,
    endpoint: TransportEndpoint,
  ): ConnectionTransport;
  transport(id: string): ConnectionTransport | undefined;
  disableTransport(id: string, now: number): boolean;
  createAuthorization(
    input: NewAuthorization,
    now: number,
    sealHttpsCredentials?: (authorizationId: string) => string,
  ): ConnectionAuthorization;
  authorization(id: string): ConnectionAuthorization | undefined;
  hasBaseAccess(
    instanceId: string,
    localProfileId: string,
    now: number,
  ): boolean;
  requireReauthentication(id: string): boolean;
  revokeAuthorization(id: string, now: number): boolean;
  disconnect(id: string, now: number, forget: boolean): boolean;
  pendingAgentRevocations(transportId: string, now: number): string[];
  acknowledgeAgentRevocation(transportId: string, grantId: string): void;
  revokeAgentGrant(
    transportId: string,
    localGrantId: string,
    now: number,
  ): boolean;
  invalidateRestoredAuthorizations(now: number): number;
  httpsCredentials(
    id: string,
    now: number,
  ): { envelope: string; generation: number } | undefined;
  replaceHttpsCredentials(
    id: string,
    envelope: string,
    expectedGeneration: number,
    now: number,
  ): boolean;
}
