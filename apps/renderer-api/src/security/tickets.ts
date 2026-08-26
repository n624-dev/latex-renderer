import { AppError, parseBearer } from "@latex-renderer/shared";
import type {
  SourceTicketClaims,
  TicketClaims,
  TicketScope,
} from "@latex-renderer/ticket";
import type { RendererApiDependencies } from "../types.js";

export function validatedJobId(value: string): string {
  if (!/^job_[a-f0-9]{32}$/.test(value))
    throw new AppError("INVALID_JOB_ID", "Job id is invalid", 400);
  return value;
}
export function validatedSourceId(value: string): string {
  if (!/^source_[a-f0-9]{32}$/.test(value))
    throw new AppError("INVALID_SOURCE_ID", "Source id is invalid", 400);
  return value;
}
export async function verifySourceUploadTicket(
  deps: RendererApiDependencies,
  authorization: string | undefined,
  sourceId: string,
): Promise<SourceTicketClaims> {
  return deps.tickets.verifySourceUpload(parseBearer(authorization), sourceId);
}

export async function verifyTicket(
  deps: RendererApiDependencies,
  authorization: string | undefined,
  scope: TicketScope,
  jobId: string,
): Promise<TicketClaims> {
  return deps.tickets.verify(parseBearer(authorization), scope, jobId);
}
