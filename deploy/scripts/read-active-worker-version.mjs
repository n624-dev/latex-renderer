#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function activeWorkerVersion(deployments) {
  if (!Array.isArray(deployments) || deployments.length === 0) {
    throw new Error("Wrangler returned no Worker deployments");
  }
  const latest = [...deployments].sort((left, right) => {
    const leftTime = Date.parse(left?.created_on ?? "");
    const rightTime = Date.parse(right?.created_on ?? "");
    if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
      throw new Error("Wrangler deployment has an invalid creation time");
    }
    return rightTime - leftTime;
  })[0];
  const version = latest?.versions?.find(
    (candidate) => candidate.percentage === 100,
  )?.version_id;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("Latest Worker deployment has no 100% active version");
  }
  return version;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const path = process.argv[2];
  if (path === undefined)
    throw new Error("usage: read-active-worker-version.mjs DEPLOYMENTS_JSON");
  const deployments = JSON.parse(readFileSync(path, "utf8"));
  process.stdout.write(activeWorkerVersion(deployments));
}
