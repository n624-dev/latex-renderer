import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { rendererRelayAgentIdSchema } from "@latex-renderer/contracts";
import { createAgent } from "./agent.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integer(name: string, max: number): number {
  const value = Number(required(name));
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    throw new Error(`${name} must be a valid integer`);
  return value;
}

function secretFromFile(name: string): string {
  const value = readFileSync(required(name), "utf8").trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(value))
    throw new Error("Invalid local relay agent secret");
  return value;
}
const instanceId = required("RENDERER_RELAY_INSTANCE_ID");
if (!/^instance_[a-f0-9]{32}$/.test(instanceId))
  throw new Error("Invalid Renderer installation ID");
const localPort = integer("RENDERER_RELAY_AGENT_PORT", 65535);
const agent = createAgent({
  origin: required("RENDERER_RELAY_GATEWAY_ORIGIN"),
  instanceId,
  transportId: rendererRelayAgentIdSchema.parse(
    required("RENDERER_RELAY_TRANSPORT_ID"),
  ),
  key: createPrivateKey(
    readFileSync(required("RENDERER_RELAY_AGENT_KEY_FILE")),
  ),
  maximumBytes: integer("RENDERER_RELAY_MAX_FRAME_BYTES", 2_147_483_647),
  capacity: integer("RENDERER_RELAY_MAX_OPERATIONS", 1000),
  timeoutMs: integer("RENDERER_RELAY_TIMEOUT_MS", 2_147_483_647),
  secret: secretFromFile("RENDERER_RELAY_AGENT_SECRET_FILE"),
  adminSecret: secretFromFile("RENDERER_RELAY_AGENT_ADMIN_SECRET_FILE"),
  localPort,
});
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => controller.abort());
agent.server.listen(localPort, "127.0.0.1");
try {
  await agent.connection.run(controller.signal);
} catch {
  console.error(
    "Agent registration was rejected. Register this installation again before restarting the agent.",
  );
  process.exitCode = 78;
} finally {
  agent.server.close();
}
