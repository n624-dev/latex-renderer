import type { DatabaseSync } from "node:sqlite";
import type { ProductionAuthenticationPlan } from "../../packages/server-setup-core/src/index.mjs";
export function requireServerSetupRecoveryOrdering(
  before: unknown,
  apiRequires: unknown,
): void;
export function checkAuthenticationHealth(
  contents: string,
  runtime?: boolean,
  fetchImpl?: typeof fetch,
  wait?: (milliseconds: number) => Promise<unknown>,
): Promise<void>;
export function requireAuthenticationOwner(
  database: DatabaseSync,
  plan: ProductionAuthenticationPlan,
): void;
