export const HTTP_SERVICE_PORTS: Readonly<Record<string, number>>;
export const HTTP_SERVICE_UNITS: readonly string[];
export function httpSocketUnit(unit: string): string | undefined;
export interface HttpServiceState {
  service: string;
  state: string;
  operational: boolean;
  active: boolean;
  managed: boolean;
}
export function httpServicesSnapshot(): {
  managed: boolean;
  services: HttpServiceState[];
};
export function httpServiceStatus(
  unit: string,
  options?: { run?: (...args: string[]) => string; aliases?: boolean },
): HttpServiceState;
export function supportsHttpActivation(source?: string): boolean;
export function supportsWorkerActivation(source?: string): boolean;
export function workerActivationEnabled(options?: {
  source?: string;
  values?: NodeJS.ProcessEnv;
}): boolean;
export function httpActivationEnabled(options?: {
  source?: string;
  values?: NodeJS.ProcessEnv;
}): boolean;
export function controlService(
  action: string,
  unit: string,
  options?: { run?: (...args: string[]) => string; enabled?: boolean },
): string;
export function controlServices(
  action: string,
  units: readonly string[],
  options?: {
    run?: (...args: string[]) => string;
    enabledFor?: (unit: string) => boolean;
  },
): void;
export function prepareHttpActivation(
  source: string,
  options?: {
    run?: (...args: string[]) => string;
    unitRoot?: string;
    values?: NodeJS.ProcessEnv;
    validateCompact?: () => unknown;
  },
): { enabled: boolean };
export function deploymentUpdater(
  action: string,
  expectedPid?: string,
  options?: {
    run?: (...args: string[]) => string;
    source?: string;
    values?: NodeJS.ProcessEnv;
    parentMutationLock?: string;
  },
): string;
export function reconcileHttpServices(options?: {
  source?: string;
  run?: (...args: string[]) => string;
  unitRoot?: string;
  values?: NodeJS.ProcessEnv;
  acquire?: () => Promise<{ release(): Promise<void> }>;
  configureEngine?: (compact: boolean) => void;
}): Promise<{ enabled: boolean }>;
