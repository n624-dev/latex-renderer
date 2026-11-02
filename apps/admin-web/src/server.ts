import { createAdaptorServer } from "@hono/node-server";
import {
  startHttpService,
  createHttpActivity,
} from "../../../deploy/scripts/http-idle-server.mjs";
import { createWebApp } from "./app.js";
import { loadClientDistribution } from "./client-distribution.js";
import { loadWebConfig } from "./config.js";
import { createStatusProbe } from "./status-probe.js";

if (process.env.ADMIN_UI_ENABLED === "false")
  throw new Error("Web administration is disabled by configuration");
const config = loadWebConfig(),
  distribution = loadClientDistribution(config.clientDistRoot),
  app = createWebApp(distribution, createStatusProbe(config, distribution));
const activity = createHttpActivity();
startHttpService(
  createAdaptorServer({
    fetch: activity.track(app.fetch),
    hostname: "127.0.0.1",
  }),
  {
    activity,
    port: config.port,
    name: "web",
    onListening: (info) => {
      console.log(
        JSON.stringify({
          event: "web.started",
          address: info.address,
          port: info.port,
          origin: config.publicOrigin,
        }),
      );
    },
  },
);
