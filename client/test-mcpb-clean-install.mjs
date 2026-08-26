import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { unpackExtension } from "@anthropic-ai/mcpb";

const repository = resolve(import.meta.dirname, ".."),
  outputRoot = join(repository, "client-dist"),
  metadata = JSON.parse(await readFile(join(outputRoot, "mcpb.json"), "utf8")),
  archive = join(outputRoot, metadata.archive),
  expectedPlatform =
    process.argv.slice(2).find((value) => value !== "--") ?? process.platform,
  temporary = await mkdtemp(join(tmpdir(), "latex-renderer-mcpb-install-"));

try {
  if (
    !(await unpackExtension({
      mcpbPath: archive,
      outputDir: temporary,
      silent: true,
    }))
  )
    throw new Error("MCPB clean extraction failed");
  const manifest = JSON.parse(
    await readFile(join(temporary, "manifest.json"), "utf8"),
  );
  if (!manifest.compatibility?.platforms?.includes(expectedPlatform))
    throw new Error(`MCPB does not declare ${expectedPlatform} compatibility`);
  if (manifest.server?.mcp_config?.command !== "node")
    throw new Error("MCPB does not use the host-provided Node runtime");
  const server = spawn(
    process.execPath,
    [join(temporary, "server/index.cjs")],
    {
      cwd: temporary,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        LATEX_RENDER_API_KEY: `lrk_${"a".repeat(32)}_${"A".repeat(43)}`,
        LATEX_RENDER_BASE_URL: "https://latex.example.com",
      },
    },
  );
  try {
    const initialized = response(server, 1);
    server.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "mcpb-clean-install", version: "1" },
        },
      })}\n`,
    );
    await initialized;
    const tools = response(server, 2);
    server.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`,
    );
    const listed = await tools;
    if (
      !Array.isArray(listed.result?.tools) ||
      !listed.result.tools.some((tool) => tool.name === "render_project")
    )
      throw new Error("MCPB server did not expose local rendering tools");
  } finally {
    await stopServer(server);
  }
  process.stdout.write(
    `MCPB clean-install check passed for ${expectedPlatform}.\n`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await exited;
}

function response(child, id) {
  return new Promise((resolveResponse, reject) => {
    let buffered = "";
    const timer = setTimeout(
      () => reject(new Error(`MCPB server response ${id} timed out`)),
      10_000,
    );
    const onData = (chunk) => {
      buffered += chunk.toString("utf8");
      for (;;) {
        const newline = buffered.indexOf("\n");
        if (newline < 0) return;
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (line === "") continue;
        const value = JSON.parse(line);
        if (value.id !== id) continue;
        clearTimeout(timer);
        child.stdout.off("data", onData);
        resolveResponse(value);
        return;
      }
    };
    child.stdout.on("data", onData);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer);
        reject(new Error(`MCPB server exited with ${code}`));
      }
    });
  });
}
