#!/usr/bin/env node
import {
  DEFAULT_DISTRIBUTION_URI,
  fetchDistribution,
  installDistribution,
  saveCredential,
  type McpTarget,
  type SkillTarget,
} from "@latex-renderer/setup-core";
import process from "node:process";
import { Writable } from "node:stream";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    process.stdout.write(
      "Usage: node install.mjs [--base-uri URL] [--install-directory PATH] [--bin-directory PATH] [--skill-target both|codex|claude|none] [--mcp-target both|codex|claude|none] [--api-key-stdin] [--json]\n",
    );
    return;
  }
  const json = args.includes("--json");
  const distribution = await fetchDistribution({
    baseUri: option(args, "--base-uri") ?? DEFAULT_DISTRIBUTION_URI,
  });
  const installDirectory = option(args, "--install-directory");
  const binDirectory = option(args, "--bin-directory");
  const result = await installDistribution({
    ...distribution,
    ...(installDirectory ? { installDirectory } : {}),
    ...(binDirectory ? { binDirectory } : {}),
    skillTarget: target(option(args, "--skill-target") ?? "both"),
    mcpTarget: target(option(args, "--mcp-target") ?? "both"),
    ...(json ? { output: quietWriter, warning: quietWriter } : {}),
  });
  let credentialStored = false;
  if (args.includes("--api-key-stdin")) {
    await saveCredential((await readStdin()).trim());
    credentialStored = true;
  }
  if (json)
    process.stdout.write(
      `${JSON.stringify({
        success: true,
        command: "setup",
        result: { ...result, credentialStored },
      })}\n`,
    );
}

const quietWriter = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${name} requires a value`);
  return value;
}

function target(value: string): SkillTarget & McpTarget {
  if (
    value === "both" ||
    value === "codex" ||
    value === "claude" ||
    value === "none"
  )
    return value;
  throw new Error("Target must be both, codex, claude, or none");
}

async function readStdin(): Promise<string> {
  let value = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) value += String(chunk);
  return value;
}

void main().catch((error: unknown) => {
  if (process.argv.includes("--json"))
    process.stdout.write(
      `${JSON.stringify({
        success: false,
        command: "setup",
        error: {
          code: "SETUP_FAILED",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      })}\n`,
    );
  else
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
  process.exitCode = 1;
});
