import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { buffer } from "node:stream/consumers";
import { URL } from "node:url";

export const fixtureCredential = `lrk_${"a".repeat(32)}_${"A".repeat(43)}`;

export async function checkPackagedMcp(child) {
  const exited = new Promise((resolve) => child.once("close", resolve));
  const lines = createInterface({ input: child.stdout });
  const query = async (message) => {
    const signal = globalThis.AbortSignal.timeout(10_000);
    const response = once(lines, "line", { signal });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
    const [line] = await response;
    const value = JSON.parse(line);
    assert.equal(value.id, message.id);
    return value.result;
  };
  let launchError;
  child.once("error", (error) => {
    launchError = error;
    lines.close();
  });
  try {
    const initialized = await query({
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "package-installation-test", version: "1" },
      },
    });
    assert(initialized?.serverInfo?.name);
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
        "\n",
    );
    const listed = await query({ id: 2, method: "tools/list", params: {} });
    assert(listed?.tools.some(({ name }) => name === "render_project"));
  } catch (error) {
    throw launchError ?? error;
  } finally {
    child.stdin.end();
    lines.close();
    child.kill();
    await exited;
  }
}

/** Check the installed launcher saves the exact PDF delivered by a local test API. */
export async function checkPackagedRender(directory, run) {
  await mkdir(directory, { mode: 0o700 });
  await writeFile(
    join(directory, "main.tex"),
    "\\documentclass{article}\n\\begin{document}\nHello, LaTeX!\n\\end{document}\n",
  );
  const sourceId = "source_" + "1".repeat(32);
  const jobId = "job_" + "2".repeat(32);
  const sourcePath = `/api/v1/sources/${sourceId}/content`;
  const jobPath = `/api/v1/jobs/${jobId}`;
  const artifactPath = `${jobPath}/artifacts/result.pdf`;
  const pdf = Buffer.from("%PDF-1.4\n% Test renderer output\n%%EOF\n");
  const sourceTicket = "fixture-source-ticket";
  const jobTicket = "fixture-render-ticket";
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  const requests = [];
  let origin;
  let requestError;
  let source;
  const server = createServer(async (request, response) => {
    try {
      const { pathname } = new URL(request.url, origin);
      const requestId = `${request.method} ${pathname}`;
      requests.push(requestId);
      const json = (value) => {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(value));
      };
      switch (requestId) {
        case "GET /api/v1/source-tickets":
          assert(
            request.headers.authorization === `Bearer ${fixtureCredential}`,
          );
          json({
            maxUploadBytes: 20 * 1024 ** 2,
            maxExtractedBytes: 100 * 1024 ** 2,
            maxFileCount: 500,
            maxZipEntries: 1_000,
          });
          break;
        case "POST /api/v1/source-tickets":
          assert(
            request.headers.authorization === `Bearer ${fixtureCredential}`,
          );
          source = JSON.parse((await buffer(request)).toString("utf8"));
          json({
            sourceId,
            uploadRequired: true,
            uploadTicket: sourceTicket,
            uploadUrl: `${origin}${sourcePath}`,
            expiresAt,
          });
          break;
        case `PUT ${sourcePath}`: {
          assert(request.headers.authorization === `Bearer ${sourceTicket}`);
          const bytes = await buffer(request);
          assert.equal(bytes.length, source.size);
          assert.equal(digest(bytes), source.sha256);
          response.writeHead(204).end();
          break;
        }
        case "POST /api/v1/render-tickets":
          assert(
            request.headers.authorization === `Bearer ${fixtureCredential}`,
          );
          assert.deepEqual(
            JSON.parse((await buffer(request)).toString("utf8")),
            {
              sourceId,
              entrypoint: "main.tex",
              outputs: ["pdf"],
            },
          );
          json({ jobId, jobTicket, expiresAt });
          break;
        case `GET ${jobPath}`:
          assert(request.headers.authorization === `Bearer ${jobTicket}`);
          json({
            id: jobId,
            status: "succeeded",
            sourceSize: source.size,
            sourceSha256: source.sha256,
            createdAt: expiresAt,
            updatedAt: expiresAt,
            errorCode: null,
            errorMessage: null,
            retentionExpiresAt: expiresAt,
            artifacts: [
              {
                type: "pdf",
                relativePath: "result.pdf",
                size: pdf.length,
                sha256: digest(pdf),
                createdAt: expiresAt,
                downloadUrl: artifactPath,
              },
            ],
          });
          break;
        case `GET ${artifactPath}`:
          assert(request.headers.authorization === `Bearer ${jobTicket}`);
          response.end(pdf);
          break;
        default:
          throw new Error(`Unexpected fixture request: ${requestId}`);
      }
    } catch (error) {
      requestError = error;
      response.writeHead(500).end();
    }
  });
  server.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    origin = `http://127.0.0.1:${server.address().port}`;
    try {
      await run(directory, origin);
    } catch (error) {
      throw requestError ?? error;
    }
    assert.deepEqual(await readFile(join(directory, "main.pdf")), pdf);
    // Clients published before the limits endpoint skip the preflight.
    const operations =
      requests[0] === "GET /api/v1/source-tickets" ? requests.slice(1) : requests;
    assert.deepEqual(operations, [
      "POST /api/v1/source-tickets",
      `PUT ${sourcePath}`,
      "POST /api/v1/render-tickets",
      `GET ${jobPath}`,
      `GET ${artifactPath}`,
    ]);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
}

export function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
