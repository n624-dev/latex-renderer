// Tiny disposable-process fixture; production entry points use validated env.
import { createServer } from "node:http";
import { setTimeout, setInterval, clearInterval } from "node:timers";
import {
  startHttpService,
  createHttpActivity,
} from "../scripts/http-idle-server.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { createRequire } from "node:module";
import { pathToFileURL, URL } from "node:url";
const [port, mode = "activated", timeout = "180"] = process.argv.slice(2);
if (!["ordinary", "systemd"].includes(mode)) {
  process.env.LISTEN_PID = String(process.pid);
  process.env.LISTEN_FDS = "1";
  process.env.LISTEN_FDNAMES = "http";
}
const activity = createHttpActivity();
let server = createServer(
  activity.track(async (req, res) => {
    if (req.url === "/stream") {
      res.setHeader("Content-Type", "text/event-stream");
      const interval = setInterval(() => res.write("data: active\n\n"), 30);
      setTimeout(() => {
        clearInterval(interval);
        res.end("data: complete\n\n");
      }, 700);
    } else if (req.url === "/upload") {
      req.resume();
      req.once("end", () => res.end("uploaded"));
    } else if (req.url === "/delay") {
      setTimeout(() => res.end("complete"), 700);
    } else if (req.url === "/abandoned") {
      req.resume();
      await delay(700);
      res.end("completed after disconnect");
    } else res.end("ok");
  }),
);
if (mode === "mcp") {
  const require = createRequire(
    new URL("../../apps/remote-mcp/package.json", import.meta.url),
  );
  const { createAdaptorServer } = await import(
    pathToFileURL(require.resolve("@hono/node-server"))
  );
  const { McpServer, createMcpHandler } = await import(
    pathToFileURL(require.resolve("@modelcontextprotocol/server"))
  );
  const handler = createMcpHandler(
    () => new McpServer({ name: "idle-fixture", version: "1.0.0" }),
    { responseMode: "json", legacy: "stateless" },
  );
  server = createAdaptorServer({
    fetch: activity.track((request) => handler.fetch(request)),
  });
}
startHttpService(server, {
  port: Number(port),
  activity,
  name: "fixture",
  configuration: { enabled: mode !== "disabled", timeoutMs: Number(timeout) },
  busyUntil: () => (mode === "lease" ? began + 700 : 0),
});
const began = Date.now();
