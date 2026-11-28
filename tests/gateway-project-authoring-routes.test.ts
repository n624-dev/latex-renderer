import { expect, it, vi } from "vitest";
import {
  gatewayRoute,
  proxyGatewayJson,
} from "../packages/gateway-core/src/index.js";

const projectId = `project_${"1".repeat(32)}`;
const revisionId = `revision_${"2".repeat(32)}`;
const base = `/api/v1/projects/${projectId}`;
const zipPath = `${base}/revisions/${revisionId}/source.zip`;

it.each([
  ["/document-state", ["GET"]],
  ["/document-state/conditions", ["PATCH"]],
  ["/document-state/adoption", ["POST"]],
  ["/pdf-reviews", ["GET", "POST"]],
  ["/storage-usage", ["GET"]],
  ["/revision-protection", ["POST"]],
  ["/revision-cleanup/plan", ["POST"]],
  ["/revision-cleanup/apply", ["POST"]],
  [`/revisions/${revisionId}/source.zip`, ["GET"]],
] as const)(
  "allowlists %s with only its documented methods",
  (suffix, authorized) => {
    const allowed: readonly string[] = authorized;
    for (const method of ["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD"]) {
      const path = base + suffix;
      expect(gatewayRoute(path, method)).toEqual(
        allowed.includes(method)
          ? {
              upstreamPath: path.replace(/^\/api/, "/internal"),
              idempotencyRequired: false,
              bodyRequired: method !== "GET",
            }
          : "method-not-allowed",
      );
    }
    expect(gatewayRoute(`${base}${suffix}/other`, "GET")).toBeUndefined();
    expect(
      gatewayRoute(`/api/v1/projects/incorrect${suffix}`, "GET"),
    ).toBeUndefined();
  },
);

it("streams a private ZIP beyond the JSON cap and forwards only download metadata", async () => {
  const chunk = new Uint8Array(1024 * 1024 + 1).fill(23);
  const etag = `"${"a".repeat(64)}"`;
  let finish: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunk);
      finish = () => controller.close();
    },
  });
  const fetchUpstream = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(stream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(chunk.length),
        "X-Source-Zip-Size": String(chunk.length),
        "Content-Disposition": `attachment; filename="${revisionId}.zip"`,
        ETag: etag,
        "X-Internal-Only": "private",
      },
    }),
  );
  const token = `Bearer lrk_${"1".repeat(32)}_${"a".repeat(43)}`;
  const upstreamPath = zipPath.replace(/^\/api/, "/internal");
  const response = await proxyGatewayJson({
    request: new Request(`https://renderer.example.test${zipPath}`, {
      headers: { Authorization: token },
    }),
    requestId: "test",
    upstreamPath,
    bodyRequired: false,
    fetchUpstream,
  });
  finish?.();
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(response.headers.get("ETag")).toBe(etag);
  expect(response.headers.get("Content-Length")).toBe(String(chunk.length));
  expect(response.headers.get("X-Source-Zip-Size")).toBe(String(chunk.length));
  expect(response.headers.get("Content-Disposition")).toContain(
    `${revisionId}.zip`,
  );
  expect(response.headers.has("X-Internal-Only")).toBe(false);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(chunk);
  const [url, init] = fetchUpstream.mock.calls[0] ?? [];
  expect(url instanceof URL && url.href).toBe(
    `http://internal-api.local${upstreamPath}`,
  );
  expect(new Headers(init?.headers).get("Authorization")).toBe(token);
});
