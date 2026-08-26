import { Hono } from "hono";
import { createJobsRouter } from "./jobs.js";
import { createSourcesRouter } from "./sources.js";
import type { RendererApiDependencies } from "../types.js";

export function createRendererV1Router(deps: RendererApiDependencies): Hono {
  const r = new Hono();
  r.route("/jobs", createJobsRouter(deps));
  r.route("/sources", createSourcesRouter(deps));
  return r;
}
