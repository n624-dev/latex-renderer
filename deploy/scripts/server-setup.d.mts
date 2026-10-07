import type { ServerSetupSessionHost } from "../../packages/server-setup-core/src/index.mjs";
export function serverSetupChildEnvironment(
  extraCa?: string,
  uid?: number,
): Promise<
  Readonly<{ PATH: string; LANG: string; NODE_EXTRA_CA_CERTS?: string }>
>;
export function createPreparedServerSetupHost(): Promise<ServerSetupSessionHost>;
