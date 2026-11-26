import { rendererRelayEnrollmentPaths } from "@latex-renderer/contracts";
import { readBoundedBody } from "@latex-renderer/shared/bounded-body";
import type { AgentEnrollmentClient } from "./enrollment.js";

export function createAgentEnrollmentClient(
  gatewayOrigin: string,
  maxResponseBytes: number,
  gatewayFetch: (request: Request) => Promise<Response> = fetch,
): AgentEnrollmentClient {
  const gateway = URL.parse(gatewayOrigin);
  if (
    !gateway ||
    gateway.protocol !== "https:" ||
    gateway.origin !== gatewayOrigin
  )
    throw new Error("Use an exact HTTPS origin for agent enrollment");

  return {
    async getNonce(signal) {
      const value = await post(rendererRelayEnrollmentPaths.begin, signal);
      if (
        typeof value !== "object" ||
        value === null ||
        !("nonce" in value) ||
        typeof value.nonce !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(value.nonce)
      )
        throw new Error(
          "The gateway did not issue a valid enrollment challenge",
        );
      return value.nonce;
    },
    async register(proof, signal) {
      const value = await post(
        rendererRelayEnrollmentPaths.complete,
        signal,
        JSON.stringify(proof),
      );
      if (
        typeof value !== "object" ||
        value === null ||
        !("transportId" in value) ||
        typeof value.transportId !== "string" ||
        !/^transport_[a-f0-9]{32}$/.test(value.transportId)
      )
        throw new Error("The gateway did not confirm agent registration");
      return { transportId: value.transportId };
    },
  };

  async function post(
    path: string,
    signal: AbortSignal,
    body?: string,
  ): Promise<unknown> {
    const response = await gatewayFetch(
      new Request(new URL(path, gatewayOrigin), {
        method: "POST",
        signal,
        redirect: "error",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "identity",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body }),
      }),
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Agent registration was rejected by the gateway");
    }
    try {
      return JSON.parse(
        await readBoundedBody(response, "application/json", maxResponseBytes),
      ) as unknown;
    } catch {
      throw new Error("The gateway returned an invalid enrollment response");
    }
  }
}
