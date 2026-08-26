import { Hono } from "hono";
import { z } from "zod";
import { createApiKeySchema, createServiceAccountSchema } from "@latex-renderer/contracts";
import { requireActor } from "../auth/actor.js";
import { AdminApiKeysService } from "../services/api-keys.js";
import { ServiceAccountsService } from "../services/service-accounts.js";
import type { AdminDependencies } from "../types.js";
import { parse } from "./helpers.js";

export function createServiceAccountsRouter(deps:AdminDependencies):Hono{
  const r=new Hono(),service=new ServiceAccountsService(deps),keys=new AdminApiKeysService(deps);
  r.get("/",async(c)=>{await requireActor(deps,c,"admin:service-accounts:read");return c.json({items:service.list()});});
  r.get("/:id",async(c)=>{await requireActor(deps,c,"admin:service-accounts:read");return c.json(service.get(c.req.param("id")));});
  r.post("/",async(c)=>{const actor=await requireActor(deps,c,"admin:service-accounts:write"),input=parse(createServiceAccountSchema,await c.req.json<unknown>());return c.json({id:service.create(actor,input)},201);});
  r.post("/:id/api-keys",async(c)=>{const actor=await requireActor(deps,c,"admin:api-keys:write"),input=parse(createApiKeySchema,await c.req.json<unknown>());return c.json(keys.create(actor,c.req.param("id"),input),201);});
  r.post("/:id/:action",async(c)=>{const actor=await requireActor(deps,c,"admin:service-accounts:write"),action=parse(z.enum(["enable","disable"]),c.req.param("action"));return c.json(service.changeStatus(actor,c.req.param("id"),action));});
  r.patch("/:id",async(c)=>{const actor=await requireActor(deps,c,"admin:service-accounts:write"),input=parse(z.object({name:z.string().min(1).max(100).optional(),clientType:z.enum(["codex","claude-code","mcp","ci","generic"]).optional()}).refine(v=>v.name!==undefined||v.clientType!==undefined),await c.req.json<unknown>());service.update(actor,c.req.param("id"),input);return c.json({id:c.req.param("id"),updated:true});});
  r.delete("/:id",async(c)=>{const actor=await requireActor(deps,c,"admin:service-accounts:write");service.delete(actor,c.req.param("id"));return c.body(null,204);});
  return r;
}
