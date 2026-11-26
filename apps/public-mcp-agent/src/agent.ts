import { createHash, timingSafeEqual } from "node:crypto";
import { createAdaptorServer } from "@hono/node-server";
import {
  rendererRelayAgentDownloadPath,
  rendererRelayAgentOperationPath,
  rendererRelayAgentRevokePath,
  rendererRelayDownloadRequestSchema,
  rendererRelayRequestSchema,
} from "@latex-renderer/contracts";
import { readBoundedBody } from "@latex-renderer/shared/bounded-body";
import { AgentGatewayConnection } from "./gateway-connection.js";

export function createAgent(
  options: Omit<
    ConstructorParameters<typeof AgentGatewayConnection>[0],
    "execute"
  > & {
    secret: string;
    adminSecret: string;
    localPort: number;
    localFetch?: typeof fetch;
  },
) {
  const localFetch = options.localFetch ?? fetch;
  const connection = new AgentGatewayConnection({
    ...options,
    execute: executeLocally,
  });

  async function executeLocally(
    method: string,
    payload: unknown,
  ): Promise<unknown> {
    const path =
      method === "renderer.call"
        ? rendererRelayAgentOperationPath
        : method === "renderer.revoke"
          ? rendererRelayAgentRevokePath
          : method === "renderer.download"
            ? rendererRelayAgentDownloadPath
            : undefined;
    if (
      path === undefined ||
      (method === "renderer.call" &&
        !rendererRelayRequestSchema.safeParse(payload).success) ||
      (method === "renderer.download" &&
        !rendererRelayDownloadRequestSchema.safeParse(payload).success)
    )
      throw new Error("Unsupported agent operation");
    const response = await localFetch(`http://127.0.0.1:3104${path}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.secret}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { relayStatus: response.status };
    }
    return JSON.parse(
      await readBoundedBody(response, "application/json", options.maximumBytes),
    ) as unknown;
  }

  const secret = digest(`Bearer ${options.secret}`);
  const adminSecret = digest(`Bearer ${options.adminSecret}`);
  const server = createAdaptorServer({
    hostname: "127.0.0.1",
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (
        request.headers.get("Host") !== `127.0.0.1:${options.localPort}` ||
        !timingSafeEqual(
          digest(request.headers.get("Authorization") ?? ""),
          pathname === "/agent/retire" ? adminSecret : secret,
        )
      )
        return new Response(null, { status: 404 });
      if (request.method === "GET" && pathname === "/health")
        return Response.json({ online: connection.online });
      if (request.method === "POST" && pathname === "/agent/retire") {
        try {
          return Response.json(
            await connection.call("agent.retire", null, request.signal),
          );
        } catch {
          return Response.json({ error: "agent_unavailable" }, { status: 503 });
        }
      }
      const method =
        pathname === "/pair/claim"
          ? "pair.claim"
          : pathname === "/pair/approve"
            ? "pair.approve"
            : pathname === "/pair/revoke"
              ? "pair.revoke"
              : undefined;
      if (!method || request.method !== "POST")
        return new Response(null, { status: 404 });
      try {
        const value: unknown = JSON.parse(
          await readBoundedBody(request, "application/json", 4096),
        );
        const result = await connection.call(method, value, request.signal);
        return Response.json(result);
      } catch {
        return Response.json({ error: "agent_unavailable" }, { status: 503 });
      }
    },
  });
  return { connection, server };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}
