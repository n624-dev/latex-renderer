import { rendererRelayEnrollmentPaths } from "@latex-renderer/contracts";
import { readBoundedBody } from "@latex-renderer/shared/bounded-body";
import type { GatewayAgentEnrollment } from "./agent-enrollment.js";

export function createAgentEnrollmentHandler(options: {
  enrollment: GatewayAgentEnrollment;
  maximumProofBytes: number;
  allowEnrollment: (request: Request) => boolean;
}) {
  return async (request: Request): Promise<Response | undefined> => {
    const url = new URL(request.url);
    const { begin, complete } = rendererRelayEnrollmentPaths;
    if (url.pathname !== begin && url.pathname !== complete) return undefined;
    if (
      url.origin !== options.enrollment.gatewayOrigin ||
      url.search ||
      request.method !== "POST"
    )
      return reply({ error: "invalid_enrollment_request" }, 400);
    if (!options.allowEnrollment(request))
      return reply({ error: "enrollment_rate_limited" }, 429);
    if (url.pathname === begin) {
      if (request.body !== null)
        return reply({ error: "invalid_enrollment_request" }, 400);
      try {
        return reply({ nonce: options.enrollment.begin() }, 201);
      } catch {
        return reply({ error: "enrollment_unavailable" }, 503);
      }
    }
    try {
      const proof: unknown = JSON.parse(
        await readBoundedBody(
          request,
          "application/json",
          options.maximumProofBytes,
        ),
      );
      return reply(options.enrollment.complete(proof), 201);
    } catch {
      return reply({ error: "invalid_enrollment_proof" }, 400);
    }
  };
}

function reply(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
