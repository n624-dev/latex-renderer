import { execFile, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execFileAsync = promisify(execFile);

it.skipIf(process.platform === "win32")(
  "registers an Admin CLI credential before command parsing starts",
  () => {
    const configRoot = mkdtempSync(join(tmpdir(), "latex-render-admin-cli-"));
    const key = `lra_${"a".repeat(32)}_${"b".repeat(43)}`;
    try {
      chmodSync(configRoot, 0o700);
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "apps/admin-cli/src/index.ts",
          "auth",
          "login",
          "--api-key-stdin",
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            XDG_CONFIG_HOME: configRoot,
            LATEX_RENDER_ADMIN_API_KEY: "",
          },
          input: `${key}\n`,
          encoding: "utf8",
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toContain(key);
      const credential = join(configRoot, "latex-renderer", "admin-credential");
      expect(readFileSync(credential, "utf8")).toBe(key);
      expect(statSync(credential).mode & 0o077).toBe(0);
    } finally {
      rmSync(configRoot, { recursive: true, force: true });
    }
  },
);

it("omits the CLI confirmation flag from the maintenance API request", async () => {
  let requestBody: unknown;
  const server = createServer((request, response) => {
    void (async () => {
      expect(request.method).toBe("POST");
      expect(request.url).toBe("/admin/api/v1/system/maintenance/enable");
      const chunks: Uint8Array[] = [];
      for await (const chunk of request as AsyncIterable<unknown>) {
        if (!Buffer.isBuffer(chunk)) throw new Error("Invalid request chunk");
        chunks.push(chunk);
      }
      requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"mode":"read-only"}');
    })().catch(() => {
      response.writeHead(500);
      response.end("Invalid fixture request");
    });
  });
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${port}`;
    await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        "apps/admin-cli/src/index.ts",
        "maintenance",
        "enable",
        "--mode",
        "read-only",
        "--reason",
        "test update",
        "--yes",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          LATEX_RENDER_ADMIN_API_KEY: `lra_${"a".repeat(32)}_${"b".repeat(43)}`,
          LATEX_RENDER_BASE_URL: origin,
          LATEX_RENDER_TRUSTED_ADMIN_ORIGINS: origin,
          CF_ACCESS_CLIENT_ID: "loopback-test",
          CF_ACCESS_CLIENT_SECRET: "loopback-test",
        },
        timeout: 15_000,
      },
    );
    expect(requestBody).toEqual({ mode: "read-only", reason: "test update" });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
