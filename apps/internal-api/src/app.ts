import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { safeError } from "@latex-renderer/shared";
import { createInternalV1Router } from "./routes.js";
import type { InternalApiDependencies } from "./types.js";
export type { InternalApiDependencies } from "./types.js";
export function createInternalApp(deps:InternalApiDependencies):Hono{const app=new Hono();app.use("*",secureHeaders());app.use("*",async(c,next)=>{for(const [name,value] of Object.entries({"Cache-Control":"private, no-store, no-cache, max-age=0, must-revalidate","Cloudflare-CDN-Cache-Control":"no-store","CDN-Cache-Control":"no-store","Pragma":"no-cache","Expires":"0"}))c.header(name,value);await next();});app.route("/internal/v1",createInternalV1Router(deps));app.get("/health",c=>c.json({status:"ok"}));app.onError((error,c)=>{const safe=safeError(error);console.error(JSON.stringify({event:"internal_api.error",code:safe.code,path:c.req.path}));return c.json({error:{code:safe.code,message:safe.message}},safe.status as 400);});app.notFound(c=>c.json({error:{code:"NOT_FOUND",message:"Route not found"}},404));return app;}
