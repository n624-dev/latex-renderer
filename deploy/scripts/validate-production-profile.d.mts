export {
  parseEnvironmentFile,
  validateProfileValues,
  type ValidatedProductionProfile,
} from "../../packages/server-setup-core/src/index.mjs";
import type { ProductionAuthenticationPlan } from "../../packages/server-setup-core/src/index.mjs";
export function verifyProductionAuthSecrets(
  profile: ProductionAuthenticationPlan,
  rendererGid: number,
): void;
export function productionAuthPlanField(
  contents: string,
  field: string,
): string;
