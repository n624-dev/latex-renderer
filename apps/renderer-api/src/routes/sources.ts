import { Hono } from "hono";
import {
  validatedSourceId,
  verifySourceUploadTicket,
} from "../security/tickets.js";
import { uploadSourceContent } from "../services/upload.js";
import type { RendererApiDependencies } from "../types.js";

export function createSourcesRouter(deps: RendererApiDependencies): Hono {
  const r = new Hono();
  r.put("/:sourceId/content", async (c) => {
    const id = validatedSourceId(c.req.param("sourceId")),
      claims = await verifySourceUploadTicket(
        deps,
        c.req.header("Authorization"),
        id,
      );
    await uploadSourceContent(deps, c.req.raw, id, claims);
    return c.body(null, 204);
  });
  return r;
}
