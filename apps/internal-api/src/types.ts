import type { ApiKeyService } from "@latex-renderer/auth";
import type { RendererDatabase } from "@latex-renderer/database";
import type { TicketService } from "@latex-renderer/ticket";
export interface InternalApiDependencies { database:RendererDatabase;apiKeys:ApiKeyService;tickets:TicketService;rendererPublicUrl:string;rendererVersion:string;maxUploadBytes?:number;maxQueueLength:number;maxUserStorageBytes:number }
