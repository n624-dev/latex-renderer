import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { safeError } from "@latex-renderer/shared";
import { installNoStore } from "./middleware/no-store.js";
import { createRendererV1Router } from "./routes/index.js";
import type { RendererApiDependencies } from "./types.js";

export type { RendererApiDependencies } from "./types.js";

export function createRendererApp(deps:RendererApiDependencies):Hono{
  const app=new Hono();app.use("*",secureHeaders());installNoStore(app);
  app.route("/api/v1",createRendererV1Router(deps));
  app.route("/v1",createRendererV1Router(deps));
  app.get("/health",c=>c.json({status:"ok"}));
  app.get("/ready",async(c)=>{deps.database.raw.prepare("SELECT 1").get();const {statfs}=await import("node:fs/promises");await statfs(deps.storageRoot);return c.json({status:"ready"});});
  app.onError((error,c)=>{const safe=safeError(error);console.error(JSON.stringify({event:"renderer_api.error",code:safe.code,path:c.req.path}));return c.json({error:{code:safe.code,message:safe.message}},safe.status as ContentfulStatusCode);});
  app.notFound(c=>c.json({error:{code:"NOT_FOUND",message:"Route not found"}},404));return app;
}
