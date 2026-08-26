import { Hono } from "hono";
import { AppError } from "@latex-renderer/shared";
import { validatedJobId, verifyTicket } from "../security/tickets.js";
import { artifactResponse } from "../services/artifacts.js";
import { RendererJobsService } from "../services/jobs.js";
import { uploadSource } from "../services/upload.js";
import type { RendererApiDependencies } from "../types.js";

export function createJobsRouter(deps:RendererApiDependencies):Hono{
  const r=new Hono(),service=new RendererJobsService(deps);
  r.put("/:jobId/source",async(c)=>{const id=validatedJobId(c.req.param("jobId")),claims=await verifyTicket(deps,c.req.header("Authorization"),"upload",id);await uploadSource(deps,c.req.raw,id,claims);return c.body(null,204);});
  r.get("/:jobId",async(c)=>{const id=validatedJobId(c.req.param("jobId"));await verifyTicket(deps,c.req.header("Authorization"),"status",id);return c.json(service.status(id));});
  r.get("/:jobId/artifacts/*",async(c)=>{const id=validatedJobId(c.req.param("jobId"));await verifyTicket(deps,c.req.header("Authorization"),"download",id);return artifactResponse(deps,id,c.req.param("*")||c.req.path.split("/artifacts/").at(-1)||"");});
  r.get("/:jobId/previews/:page",async(c)=>{const id=validatedJobId(c.req.param("jobId"));await verifyTicket(deps,c.req.header("Authorization"),"download",id);const page=c.req.param("page");if(!/^page-[0-9]{1,3}\.png$/.test(page))throw new AppError("INVALID_PREVIEW","Preview name is invalid",400);return artifactResponse(deps,id,`previews/${page}`);});
  r.post("/:jobId/cancel",async(c)=>{const id=validatedJobId(c.req.param("jobId")),claims=await verifyTicket(deps,c.req.header("Authorization"),"cancel",id);return c.json(service.cancel(id,claims),202);});
  r.delete("/:jobId",async(c)=>{const id=validatedJobId(c.req.param("jobId")),claims=await verifyTicket(deps,c.req.header("Authorization"),"delete",id);service.delete(id,claims);return c.body(null,202);});
  return r;
}
