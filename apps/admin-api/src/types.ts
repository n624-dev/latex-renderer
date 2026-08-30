import type {
  ApiKeyService,
  BrowserAuthenticationService,
  DeploymentMode,
} from "@latex-renderer/auth";
import type { RendererDatabase } from "@latex-renderer/database";
import type { TicketService } from "@latex-renderer/ticket";
import type { ImageManagerClient } from "./services/image-manager.js";
import type { UpdateManagerClient } from "./services/update-manager.js";

export interface AppActor {
  type: "user" | "admin_key";
  id: string;
  role: "owner" | "admin" | "user";
  userId: string;
}

export interface AdminActor extends AppActor {
  role: "owner" | "admin";
}

export interface AdminDependencies {
  database: RendererDatabase;
  apiKeys: ApiKeyService;
  browserAuth: BrowserAuthenticationService;
  deploymentMode: DeploymentMode;
  publicOrigin: string;
  allowedOrigins: ReadonlySet<string>;
  writeEnabled: boolean;
  storageRoot: string;
  rendererVersion: string;
  imageManager?: ImageManagerClient;
  updateManager?: UpdateManagerClient;
  maxUploadBytes?: number;
  maxQueueLength: number;
  maxUserStorageBytes: number;
  minFreeStorageBytes: number;
  artifactRetentionHours?: number;
  environmentRoot?: string;
  activeTicketKid: string;
  verificationTicketKids: readonly string[];
  renderTickets?: {
    tickets: TicketService;
    rendererPublicUrl: string;
  };
}
