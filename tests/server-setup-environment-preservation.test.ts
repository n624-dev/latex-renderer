import { describe, expect, it } from "vitest";
import { importServerSetupReview } from "../packages/server-setup-core/src/index.mjs";
import { serverSetupEnvironmentFile } from "../deploy/scripts/server-setup-initial-host.mjs";

const before = [
  "# operator annotation",
  "DEPLOYMENT_MODE=standalone",
  "AUTH_MODE=password",
  "PUBLIC_ORIGIN=https://localhost:8443",
  "RENDERER_PUBLIC_URL=https://localhost:8443",
  "INGRESS_ACCESS_SCOPE=local",
  "INGRESS_TLS_PROVIDER=custom",
  "INGRESS_LISTEN_ADDRESS=127.0.0.1",
  "DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3",
  "STORAGE_ROOT=/var/lib/latex-renderer/storage",
  `RENDERER_IMAGE=sha256:${"a".repeat(64)}`,
  "ARTIFACT_RETENTION_HOURS=72",
  "IMAGE_CLEANUP_INTERVAL_HOURS=48",
  "TICKET_SIGNING_KID=v7",
  "API_KEY_PEPPER_ID=v3",
  "DOCKER_HOST=unix:///run/user/9912/docker.sock",
  "RENDERER_CONTAINER_UID=32001",
  "RENDERER_CONTAINER_GID=32002",
  "ADMIN_API_WRITE_ENABLED=false",
  "PRIVATE_FIXTURE_TOKEN=opaque=fixture-only",
  "OIDC_CLIENT_SECRET_FILE=/private/fixture-secret",
  "",
].join("\n");
describe("private HTTPS setup EnvironmentFile merge", () => {
  it("preserves unrelated settings, comments, secret references and rotated identities without changing public parser scope", () => {
    const review = importServerSetupReview(before),
      after = serverSetupEnvironmentFile("ingress", before, review, 1001);
    for (const line of before
      .split("\n")
      .filter((line) => Boolean(line) && !line.startsWith("AUTH_MODE=")))
      expect(after).toContain(line + "\n");
    expect(after).not.toContain("AUTH_MODE=");
    expect(after).toContain("AUTH_BACKEND=native\n");
    expect(importServerSetupReview(after)).toEqual(review);
    expect(JSON.stringify(review)).not.toMatch(
      /PRIVATE_FIXTURE_TOKEN|opaque|fixture-secret|TICKET_SIGNING_KID|IMAGE_CLEANUP/,
    );
  });
  it("applies reviewed fields once without duplicating the original managed keys", () => {
    const review = importServerSetupReview(before),
      modified = {
        ...review,
        runtime: {
          ...review.runtime,
          limits: { ...review.runtime.limits, maxLogBytes: 123456 },
        },
      };
    const after = serverSetupEnvironmentFile("ingress", before, modified, 1001);
    expect(after.match(/^MAX_LOG_BYTES=/gm)).toHaveLength(1);
    expect(after).toContain("MAX_LOG_BYTES=123456\n");
    expect(after).toContain("TICKET_SIGNING_KID=v7\n");
  });
  it("limits fixed initialization defaults to a fresh installation", () => {
    const after = serverSetupEnvironmentFile(
      "initial",
      before,
      importServerSetupReview(before),
      1001,
    );
    expect(after).toContain("TICKET_SIGNING_KID=v1\n");
    expect(after).toContain("API_KEY_PEPPER_ID=v1\n");
    expect(after).toContain("DOCKER_HOST=unix:///run/user/1001/docker.sock\n");
    expect(after).not.toContain("PRIVATE_FIXTURE_TOKEN");
  });
  it.each([
    before + "ARTIFACT_RETENTION_HOURS=1\n",
    before + "PRIVATE=value\r\n",
    before + "PRIVATE=value\0\n",
  ])(
    "still validates excluded/private input lines before merging",
    (contents) => {
      expect(() =>
        serverSetupEnvironmentFile(
          "ingress",
          contents,
          importServerSetupReview(before),
          1001,
        ),
      ).toThrow();
    },
  );
});
