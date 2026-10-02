import type {
  ProductionAuthenticationPlan,
  ServerSetupAuthenticationReview,
} from "../../packages/server-setup-core/src/index.mjs";
export const authenticationUnits: readonly [
  "latex-renderer-admin-api.service",
  "latex-renderer-remote-mcp.service",
];
export function authenticationEnvironmentHash(contents: string): string;
export interface AuthenticationChangeEnvelope {
  format: 1;
  baseSha256: string;
  candidateSha256: string;
  review: ServerSetupAuthenticationReview;
}
export function authenticationChangeReview(
  contents: string,
  input: unknown,
): {
  envelope: Readonly<AuthenticationChangeEnvelope>;
  after: string;
};
export interface AuthenticationJournal {
  format: 1;
  phase: "pending" | "committed";
  before: string;
  after: string;
}
export class AuthenticationChangeStore {
  constructor(
    environmentPath: string,
    root: string,
    uid?: number,
    gid?: number,
  );
  environmentPath: string;
  root: string;
  uid: number;
  gid: number;
  initialize(): Promise<void>;
  read(
    path: string,
    mode: number,
    gid: number,
    maximum?: number,
    minimum?: number,
  ): Promise<string>;
  environment(): Promise<string>;
  journal(): Promise<AuthenticationJournal | null>;
  sync(path: string): Promise<void>;
  saveJournal(journal: AuthenticationJournal): Promise<void>;
  replaceEnvironment(contents: string): Promise<void>;
  clear(): Promise<void>;
}
export interface AuthenticationChangeHost {
  active(this: void, unit: string): boolean | Promise<boolean>;
  run(this: void, action: string, unit: string): void | Promise<void>;
  health(this: void, contents: string): void | Promise<void>;
  preflight(this: void, contents: string): void | Promise<void>;
}
export function recoverAuthenticationChange(
  store: AuthenticationChangeStore,
  host: AuthenticationChangeHost,
  beforeStart?: boolean,
): Promise<boolean>;
export function applyAuthenticationChange(
  store: AuthenticationChangeStore,
  host: AuthenticationChangeHost,
  envelope: unknown,
): Promise<ProductionAuthenticationPlan>;
