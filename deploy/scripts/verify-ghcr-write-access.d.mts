export interface RegistryAccessClaims {
  access?: Array<{
    type?: string;
    name?: string;
    actions?: string[];
  }>;
}

export function registryAccessClaims(registryToken: string): RegistryAccessClaims;
export function hasRepositoryAction(
  claims: RegistryAccessClaims,
  repositoryPath: string,
  action: string,
): boolean;
export function verifyGhcrWriteAccess(options: {
  repository: string;
  actor: string;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<void>;
