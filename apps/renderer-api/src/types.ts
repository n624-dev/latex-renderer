import type { RendererDatabase } from "@latex-renderer/database";
import type { TicketService } from "@latex-renderer/ticket";

export interface RendererApiDependencies {
  database: RendererDatabase;
  tickets: TicketService;
  storageRoot: string;
  maxUploadBytes: number;
  maxExtractedBytes?: number;
  maxFileCount?: number;
  maxZipEntries?: number;
  minFreeStorageBytes: number;
  artifactRetentionHours: number;
}
