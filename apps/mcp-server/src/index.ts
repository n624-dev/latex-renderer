#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import {
  createMcpOperations,
  validateRenderTimeout,
} from "@latex-renderer/mcp-core";
import { positiveDurationEnvironment } from "@latex-renderer/shared";
import { createLatexRendererMcpServer } from "./server.js";

const clientVersion =
  process.env.LATEX_RENDER_CLIENT_VERSION ?? readRepositoryVersion();
const renderTimeoutMs = validateRenderTimeout(
  positiveDurationEnvironment(
    process.env,
    "LATEX_RENDER_MCP_TIMEOUT_MS",
    10 * 60 * 1000,
    30 * 60 * 1000,
  ),
);
const operations = createMcpOperations({ renderTimeoutMs });

serveStdio(() => createLatexRendererMcpServer(operations, clientVersion), {
  legacy: "serve",
  onerror: (error) =>
    process.stderr.write(`latex-renderer-mcp: ${error.message}\n`),
});

function readRepositoryVersion(): string {
  const entryPath = process.argv[1];
  if (entryPath === undefined) throw new Error("MCP entry path is unavailable");
  const value = JSON.parse(
    readFileSync(resolve(dirname(entryPath), "../../../package.json"), "utf8"),
  ) as { version?: unknown };
  if (typeof value.version !== "string" || value.version.length === 0)
    throw new Error("Root package version is invalid");
  return value.version;
}
