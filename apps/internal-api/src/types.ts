import type { ApiKeyService } from "@latex-renderer/auth";
import type {
  RendererDatabase,
  RenderStorageLimits,
} from "@latex-renderer/database";
import type { TicketService } from "@latex-renderer/ticket";
import type { ResourceLimits } from "@latex-renderer/shared";
export interface InternalApiDependencies extends RenderStorageLimits {
  database: RendererDatabase;
  apiKeys: ApiKeyService;
  tickets: TicketService;
  rendererPublicUrl: string;
  rendererVersion: string;
  maxUploadBytes?: number;
  sourceLimits?: Readonly<ResourceLimits>;
  maxOutputBytes: number;
  maxQueueLength: number;
  maxUserStorageBytes: number;
  artifactRetentionHours?: number;
}
