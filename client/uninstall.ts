#!/usr/bin/env node
import { removeSetup } from "@latex-renderer/setup-core";
import process from "node:process";
import { Writable } from "node:stream";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    process.stdout.write(
      "Usage: node uninstall.mjs [--install-directory PATH] [--bin-directory PATH] [--keep-credential] [--keep-skills] [--json]\n",
    );
    return;
  }
  const json = args.includes("--json");
  const installDirectory = option(args, "--install-directory");
  const binDirectory = option(args, "--bin-directory");
  const result = await removeSetup({
    ...(installDirectory ? { installDirectory } : {}),
    ...(binDirectory ? { binDirectory } : {}),
    keepCredential: args.includes("--keep-credential"),
    keepSkills: args.includes("--keep-skills"),
    ...(json ? { output: quietWriter, warning: quietWriter } : {}),
  });
  if (json)
    process.stdout.write(
      `${JSON.stringify({ success: true, command: "setup.remove", result })}\n`,
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

void main().catch((error: unknown) => {
  if (process.argv.includes("--json"))
    process.stdout.write(
      `${JSON.stringify({
        success: false,
        command: "setup.remove",
        error: {
          code: "SETUP_REMOVE_FAILED",
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
