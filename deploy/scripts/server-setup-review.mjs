#!/usr/bin/env node
import { Buffer } from "node:buffer";
import { pathToFileURL } from "node:url";
import {
  reviewServerSetupReadiness,
  checkServerSetupOidc,
} from "../../packages/server-setup-core/src/index.mjs";

// Non-privileged diagnostic path: accepts only the secret-free format-3/4 review
// over stdin; no root files, writes, owner mutation or service/provider fallback.
export async function runServerSetupReview(args, input, output) {
  if (args.length > 1 || (args.length === 1 && args[0] !== "--oidc-check"))
    throw new Error(
      "usage: server-setup-review.mjs [--oidc-check] < FORMAT_3_OR_4_JSON",
    );
  const chunks = [];
  let length = 0;
  for await (const chunk of input) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > 64 * 1024)
      throw new Error("Server setup review exceeds 64 KiB");
    chunks.push(bytes);
  }
  let review;
  try {
    review = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Server setup review must be JSON");
  }
  const plan = reviewServerSetupReadiness(review);
  const result = {
    ...plan,
    ...(args[0] === "--oidc-check"
      ? { oidcDiscovery: await checkServerSetupOidc(plan.review) }
      : {}),
  };
  output.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runServerSetupReview(
    process.argv.slice(2),
    process.stdin,
    process.stdout,
  ).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
