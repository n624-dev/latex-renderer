import type { ApiKeyService } from "@latex-renderer/auth";
import type { RendererDatabase } from "@latex-renderer/database";
import type { TicketService } from "@latex-renderer/ticket";
import type { ResourceLimits } from "@latex-renderer/shared";
export interface InternalApiDependencies {
  database: RendererDatabase;
  apiKeys: ApiKeyService;
  tickets: TicketService;
  rendererPublicUrl: string;
  publicOrigin?: string;
  environmentRoot?: string;
  rendererVersion: string;
  maxUploadBytes?: number;
  sourceLimits?: Readonly<ResourceLimits>;
  storageRoot?: string;
  maxOutputBytes: number;
  maxQueueLength: number;
  maxUserStorageBytes: number;
  minFreeStorageBytes?: number;
  artifactRetentionHours?: number;
}
