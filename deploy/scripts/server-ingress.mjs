#!/usr/bin/env node
import { isMainModule } from "./is-main-module.mjs";
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  lstatSync,
  readSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { networkInterfaces } from "node:os";
import { request } from "node:https";
import { URL } from "node:url";
import { setTimeout, clearTimeout } from "node:timers";
import {
  parseEnvironmentFile,
  importServerSetupDeploymentReview,
  serverIngressFromEnvironment,
  validateServerIngressTls,
  renderServerIngressNginx,
  SERVER_INGRESS_TLS_PATHS,
} from "../../packages/server-setup-core/src/index.mjs";

// Open once without following a final symlink; check/read the same descriptor.
// Nonblocking open also prevents a substituted FIFO from hanging preflight.
export function readSecureIngressFile(path, { uid, gid, mode, maximumBytes }) {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const check = () => {
      const stat = fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.uid !== uid ||
        stat.gid !== gid ||
        (stat.mode & 0o7777) !== mode ||
        stat.size < 1 ||
        stat.size > maximumBytes
      )
        throw new Error(
          "Ingress file has unsafe type, ownership, permissions, links or size",
        );
      return stat;
    };
    const before = check();
    const buffer = Buffer.alloc(maximumBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(fd, buffer, offset, buffer.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const after = check();
    if (
      offset !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      offset > maximumBytes
    )
      throw new Error("Ingress file changed while validating");
    return buffer.subarray(0, offset);
  } finally {
    closeSync(fd);
  }
}

export function verifyProductionIngressTls(review, rendererGid) {
  // Legacy/Cloudflare never read standalone certificates or call providers.
  if (review === null || review.mode === "cloudflare") return null;
  if (review.tlsProvider !== "custom")
    throw new Error("Automatic HTTPS is not implemented");
  for (const path of [
    "/etc",
    "/etc/latex-renderer",
    "/etc/latex-renderer/secrets",
  ]) {
    const stat = lstatSync(path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== 0 ||
      (stat.mode & 0o022) !== 0
    )
      throw new Error("Ingress secret directory is not root-controlled");
  }
  const options = { uid: 0, gid: rendererGid, mode: 0o440 };
  const certificate = readSecureIngressFile(
    SERVER_INGRESS_TLS_PATHS.certificate,
    { ...options, maximumBytes: 512 * 1024 },
  );
  const key = readSecureIngressFile(SERVER_INGRESS_TLS_PATHS.privateKey, {
    ...options,
    maximumBytes: 16 * 1024,
  });
  try {
    return validateServerIngressTls(review, certificate, key);
  } finally {
    key.fill(0);
  }
}

export function verifyIngressInterface(review, interfaces) {
  if (review === null || review.mode === "cloudflare") return;
  if (["0.0.0.0", "::"].includes(review.listenAddress)) return;
  const expected = new URL(
    `http://${review.listenAddress.includes(":") ? `[${review.listenAddress}]` : review.listenAddress}/`,
  ).hostname;
  const found = Object.values(interfaces ?? networkInterfaces())
    .flat()
    .some(
      (item) =>
        item &&
        new URL(
          `http://${item.address.includes(":") ? `[${item.address.split("%")[0]}]` : item.address}/`,
        ).hostname === expected,
    );
  if (!found)
    throw new Error(
      "Selected ingress interface address is not assigned on this host",
    );
}

// Actual PUBLIC_ORIGIN, normal CA trust, no redirect/HTTP/alternate snapshot.
// A valid cert/key pair alone does not prove externally trusted HTTPS health.
export function checkIngressHttpsHealth(publicOrigin) {
  const url = new URL("/api/v1/health", publicOrigin);
  if (url.protocol !== "https:" || url.origin !== publicOrigin)
    return Promise.reject(
      new Error("Health check requires an exact HTTPS origin"),
    );
  return new Promise((resolve, reject) => {
    const failure = () =>
      reject(
        new Error(
          "Ingress HTTPS health failed (TLS, status, response or deadline)",
        ),
      );
    const call = request(
      url,
      {
        method: "GET",
        minVersion: "TLSv1.2",
        rejectUnauthorized: true,
        agent: false,
      },
      (response) => {
        let bytes = 0;
        const chunks = [];
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 16 * 1024) {
            call.destroy();
            failure();
          } else chunks.push(chunk);
        });
        response.on("error", failure);
        response.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (response.statusCode !== 200 || body.status !== "ok")
              throw new Error();
            resolve(Object.freeze({ status: "ok", publicOrigin }));
          } catch {
            failure();
          }
        });
      },
    );
    const timer = setTimeout(() => {
      call.destroy();
      failure();
    }, 5000);
    call.on("error", failure);
    call.on("close", () => clearTimeout(timer));
    call.end();
  });
}

async function main() {
  if (process.geteuid?.() !== 0)
    throw new Error("server-ingress.mjs host commands must run as root");
  const [action, path, ...extra] = process.argv.slice(2);
  if (
    extra.length ||
    !path ||
    !["--review", "--check", "--nginx", "--health"].includes(action)
  )
    throw new Error(
      "usage: server-ingress.mjs --review|--check|--nginx|--health RENDERER_ENV_FILE",
    );
  const gid = Number(
    execFileSync("/usr/bin/getent", ["group", "latex-renderer"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).split(":")[2],
  );
  if (!Number.isSafeInteger(gid) || gid < 0)
    throw new Error("Renderer group is unavailable");
  const bytes = readSecureIngressFile(path, {
    uid: 0,
    gid,
    mode: 0o640,
    maximumBytes: 128 * 1024,
  });
  let contents;
  try {
    contents = bytes.toString("utf8");
  } finally {
    bytes.fill(0);
  }
  const deployment = importServerSetupDeploymentReview(contents);
  const ingress = serverIngressFromEnvironment(parseEnvironmentFile(contents));
  if (action === "--review") {
    process.stdout.write(`${JSON.stringify(deployment)}\n`);
    return;
  }
  if (ingress === null)
    throw new Error(
      "Legacy ingress has no explicit reviewed scope; configuration is unchanged",
    );
  const tls = verifyProductionIngressTls(ingress, gid);
  verifyIngressInterface(ingress);
  if (action === "--nginx")
    process.stdout.write(renderServerIngressNginx(ingress));
  else if (action === "--health")
    process.stdout.write(
      `${JSON.stringify(await checkIngressHttpsHealth(ingress.publicOrigin))}\n`,
    );
  else
    process.stdout.write(
      `${JSON.stringify({ ingress, tls, readiness: "preflight-only" })}\n`,
    );
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `Ingress command failed: ${error instanceof Error ? error.message : "unknown error"}; no configuration was applied\n`,
    );
    process.exitCode = 65;
  });
}
