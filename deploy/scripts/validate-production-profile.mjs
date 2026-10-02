#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  parseEnvironmentFile,
  validateProfileValues,
} from "../../packages/server-setup-core/src/index.mjs";
export {
  parseEnvironmentFile,
  validateProfileValues,
} from "../../packages/server-setup-core/src/index.mjs";

function groupId(name) {
  const line = execFileSync("getent", ["group", name], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const gid = Number(line.split(":")[2]);
  if (!Number.isInteger(gid))
    throw new Error(`required group ${name} was not found`);
  return gid;
}

function assertSecureFile(path, options) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`${options.label} must be a regular non-symlink file`);
  if (
    stat.uid !== 0 ||
    stat.gid !== options.gid ||
    (stat.mode & 0o777) !== options.mode
  )
    throw new Error(`${options.label} has unsafe ownership or permissions`);
  if (stat.size < options.minimumBytes || stat.size > options.maximumBytes)
    throw new Error(`${options.label} has an invalid size`);
}

function main() {
  if (process.geteuid?.() !== 0)
    throw new Error("validate-production-profile.mjs must run as root");
  if (process.argv.length !== 3)
    throw new Error("usage: validate-production-profile.mjs RENDERER_ENV_FILE");
  const environmentPath = process.argv[2];
  const rendererGid = groupId("latex-renderer");
  assertSecureFile(environmentPath, {
    label: "renderer.env",
    gid: rendererGid,
    mode: 0o640,
    minimumBytes: 1,
    maximumBytes: 128 * 1024,
  });
  const profile = validateProfileValues(
    parseEnvironmentFile(readFileSync(environmentPath, "utf8")),
  );
  if (profile.authMode === "oidc") {
    const secretPath = "/etc/latex-renderer/secrets/oidc-client-secret";
    assertSecureFile(secretPath, {
      label: "OIDC client secret",
      gid: rendererGid,
      mode: 0o440,
      minimumBytes: 16,
      maximumBytes: 16 * 1024,
    });
    const length = readFileSync(secretPath, "utf8").trim().length;
    if (length < 16 || length > 4096)
      throw new Error("OIDC client secret has an invalid trimmed length");
  } else if (profile.authMode === "password") {
    assertSecureFile("/etc/latex-renderer/secrets/auth-password-pepper", {
      label: "password authentication pepper",
      gid: rendererGid,
      mode: 0o440,
      minimumBytes: 32,
      maximumBytes: 16 * 1024,
    });
  }
  process.stdout.write(
    `Production profile verified: ${profile.deploymentMode}/${profile.authMode}\n`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `Production profile validation failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 65;
  }
}
