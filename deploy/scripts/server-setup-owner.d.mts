import type {
  ServerSetupReview,
  ServerInitialCredentials,
} from "../../packages/server-setup-core/src/index.mjs";
export function createSetupOwner(
  input: {
    databasePath: string;
    id: string;
    review: ServerSetupReview;
    owner: ServerInitialCredentials["owner"];
    pepper: string;
  },
  options?: { databasePath?: string },
): Promise<void>;
