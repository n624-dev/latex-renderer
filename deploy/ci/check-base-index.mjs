// Optional, isolated registry protocol test. No TeX execution or GHCR writes.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { publicationIndex } from "../scripts/ghcr-base-publication.mjs";

if (process.env.CI_BASE_INDEX_PROBE !== "1")
  throw new Error(
    "Set CI_BASE_INDEX_PROBE=1 to opt into an isolated Docker registry test",
  );
const run = (args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const registryImage =
  "docker.io/library/registry@sha256:ddf754342cfc8acc51a56d5d0ab6af06826461864460636d8bd5c546dab2a7b8";
const nonce = randomUUID();
const digest = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const imageIds = [];
let container, reference;
let ownsRegistryImage = false;
try {
  try {
    run(["image", "inspect", registryImage]);
  } catch {
    ownsRegistryImage = true;
  }
  container = run([
    "run",
    "-d",
    "--rm",
    "--name",
    `latex-renderer-index-probe-${nonce}`,
    "--memory",
    "128m",
    "--cpus",
    "1",
    "-p",
    "127.0.0.1::5000",
    registryImage,
  ]);
  const address = run(["port", container, "5000/tcp"]);
  if (!/^127\.0\.0\.1:\d+$/.test(address))
    throw new Error("Registry fixture is not loopback-only");
  const origin = `http://${address}`;
  const request = async (path, init = {}) => {
    const url = new globalThis.URL(path, origin);
    if (url.origin !== origin)
      throw new Error("Registry fixture escaped loopback");
    return globalThis.fetch(url, {
      ...init,
      redirect: "error",
      signal: globalThis.AbortSignal.timeout(10_000),
    });
  };
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await request("/v2/")).status === 200) break;
    } catch (error) {
      if (attempt === 49) throw error;
    }
    if (attempt === 49) throw new Error("Registry fixture did not start");
    await setTimeout(200);
  }
  const pin = {
    date: "2026-10-15",
    canonical: "https://texlive.info/tlnet-archive/2026/10/15/tlnet",
    installer: "f".repeat(128),
    commit: "f".repeat(40),
    runId: "1",
    attempt: "1",
  };
  const receipts = [];
  for (const architecture of ["amd64", "arm64"]) {
    // Empty, synthetic metadata images, NOT validated TeX Base payloads.
    // The nonce also prevents cleanup from targeting a pre-existing image.
    const config = JSON.stringify({
      architecture,
      os: "linux",
      config: { Labels: { "fixture.nonce": nonce } },
      rootfs: { type: "layers", diff_ids: [] },
      history: [],
    });
    const imageId = digest(config);
    imageIds.push(imageId);
    const start = await request("/v2/fixture/blobs/uploads/", {
      method: "POST",
    });
    assert.equal(start.status, 202);
    const upload = new globalThis.URL(start.headers.get("location"), origin);
    upload.searchParams.set("digest", imageId);
    assert.equal(
      (
        await request(upload.href, {
          method: "PUT",
          body: config,
          headers: { "Content-Type": "application/octet-stream" },
        })
      ).status,
      201,
    );
    const mediaType = "application/vnd.docker.distribution.manifest.v2+json";
    const bytes = JSON.stringify({
      schemaVersion: 2,
      mediaType,
      config: {
        mediaType: "application/vnd.docker.container.image.v1+json",
        digest: imageId,
        size: Buffer.byteLength(config),
      },
      layers: [],
    });
    const manifest = {
      mediaType,
      digest: digest(bytes),
      size: Buffer.byteLength(bytes),
    };
    assert.equal(
      (
        await request(`/v2/fixture/manifests/${manifest.digest}`, {
          method: "PUT",
          body: bytes,
          headers: { "Content-Type": mediaType },
        })
      ).status,
      201,
    );
    receipts.push({
      schema: 1,
      validated: true,
      ...pin,
      architecture,
      imageId,
      manifest,
    });
  }
  const bytes = publicationIndex(receipts, pin);
  assert.equal(
    (
      await request(`/v2/fixture/manifests/${pin.date}`, {
        method: "PUT",
        body: bytes,
        headers: { "Content-Type": "application/vnd.oci.image.index.v1+json" },
      })
    ).status,
    201,
  );
  reference = `${address}/fixture@${digest(bytes)}`;
  for (const receipt of receipts) {
    run(["pull", "--platform", `linux/${receipt.architecture}`, reference]);
    const image = JSON.parse(
      run(["image", "inspect", receipt.imageId, "--format", "{{json .}}"]),
    );
    assert.equal(image.Architecture, receipt.architecture);
    assert.equal(image.Config.Labels["fixture.nonce"], nonce);
    // Classic Docker stores one platform per digest reference. Real validation
    // uses separate fresh native runners; release this fixture reference before
    // selecting the other platform on the same test daemon.
    run(["image", "rm", reference]);
  }
  console.log(
    "OCI index / Docker v2 component interoperability passed for both platform selections (metadata only; no ARM execution).",
  );
} finally {
  if (reference)
    try {
      run(["image", "rm", reference]);
    } catch {
      /* May already be absent after a failed pull. */
    }
  for (const id of imageIds)
    try {
      run(["image", "rm", id]);
    } catch {
      /* Containerd may collect children with their index. */
    }
  if (container) run(["stop", container]);
  if (ownsRegistryImage) run(["image", "rm", registryImage]);
}
