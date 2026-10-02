import type { DatabaseSync } from "node:sqlite";
import type { ProductionAuthenticationPlan } from "../../packages/server-setup-core/src/index.mjs";
export function requireAuthenticationOwner(
  database: DatabaseSync,
  plan: ProductionAuthenticationPlan,
): void;
