import { Hono } from "hono";
import { z } from "zod";
import { maintenanceModeSchema, type MaintenanceMode } from "@latex-renderer/contracts";
import { AppError } from "@latex-renderer/shared";
import { requireActor } from "../auth/actor.js";
import { AdminSystemService } from "../services/system.js";
import type { AdminDependencies } from "../types.js";
import { parse } from "./helpers.js";

export function createSystemRouter(deps:AdminDependencies):Hono{
  const r=new Hono(),service=new AdminSystemService(deps);
  r.get("/status",async(c)=>{await requireActor(deps,c,"admin:system:read");return c.json(service.status());});
  r.get("/config",async(c)=>{await requireActor(deps,c,"admin:system:read");return c.json({items:service.config()});});
  r.get("/ticket-keys",async(c)=>{await requireActor(deps,c,"admin:system:read");return c.json(service.ticketKeys());});
  r.patch("/config",async(c)=>{const actor=await requireActor(deps,c,"admin:system:write"),input=parse(z.object({key:z.enum(["max_queue_length","max_user_storage_bytes","max_user_active_jobs","source_orphan_retention_minutes"]),value:z.number().int().positive(),reason:z.string().min(1).max(500)}).strict(),await c.req.json<unknown>());service.updateConfig(actor,input);return c.json({key:input.key,value:input.value});});
  r.post("/maintenance/:action",async(c)=>{const actor=await requireActor(deps,c,"admin:system:write"),action=parse(z.enum(["enable","disable"]),c.req.param("action"));const body=await c.req.json<unknown>().catch(()=>({}));let mode:MaintenanceMode="normal",reason:string|undefined;if(action==="enable"){const input=parse(z.object({mode:maintenanceModeSchema.exclude(["normal"]),reason:z.string().trim().min(1).max(500)}).strict(),body);mode=input.mode;reason=input.reason;}return c.json({mode:service.maintenance(actor,action,mode,reason)});});
  r.post("/ticket-keys/:kid/revoke",async(c)=>{const actor=await requireActor(deps,c,"admin:system:write"),input=parse(z.object({reason:z.string().min(1).max(500),expiresAt:z.iso.datetime()}),await c.req.json<unknown>());service.revokeTicketKey(actor,c.req.param("kid"),input);return c.json({kid:c.req.param("kid"),revoked:true});});
  return r;
}

export function createWorkerRouter(deps:AdminDependencies):Hono{
  const r=new Hono(),service=new AdminSystemService(deps);
  r.post("/:action",async(c)=>{const actor=await requireActor(deps,c,"admin:system:write"),action=c.req.param("action");if(action!=="pause"&&action!=="resume"&&action!=="drain")throw new AppError("NOT_FOUND","Route not found",404);return c.json({mode:service.worker(actor,action)});});return r;
}

export function createAuditRouter(deps:AdminDependencies):Hono{
  const querySchema=z.object({page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(50),action:z.string().trim().max(200).optional(),actor:z.string().trim().max(500).optional(),target:z.string().trim().max(500).optional(),result:z.string().trim().max(100).optional(),from:z.iso.datetime().optional(),to:z.iso.datetime().optional()});
  const r=new Hono(),service=new AdminSystemService(deps);r.get("/",async(c)=>{await requireActor(deps,c,"admin:audit:read");const query=parse(querySchema,{page:c.req.query("page"),pageSize:c.req.query("pageSize"),action:c.req.query("action"),actor:c.req.query("actor"),target:c.req.query("target"),result:c.req.query("result"),from:c.req.query("from"),to:c.req.query("to")});return c.json(service.audit(query));});return r;
}
