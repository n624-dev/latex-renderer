import { ProjectOperations } from "@latex-renderer/database";
import type { AdminDependencies } from "../types.js";

/** Browser adapter for the shared saved-Project policy. */
export class AppProjectsService extends ProjectOperations {
  constructor(deps: AdminDependencies) {
    super(deps.database);
  }
}
