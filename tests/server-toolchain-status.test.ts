import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { serverToolchainStatus } from "../deploy/scripts/server-toolchain-status.mjs";

it.skipIf(process.getuid === undefined)(
  "reports running Node and trusted Corepack metadata without executing it",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "toolchain-status-"));
    try {
      const nodePath = join(root, "node"),
        corepackPath = join(root, "dist", "corepack.js"),
        manifest = join(root, "package.json");
      await mkdir(join(root, "dist"));
      await writeFile(nodePath, "not executable");
      await writeFile(corepackPath, "throw new Error('must never execute')");
      await writeFile(
        manifest,
        JSON.stringify({ name: "corepack", version: "0.36.0" }),
        { mode: 0o644 },
      );
      const options = {
        nodePath,
        corepackPath,
        nodeVersion: "26.13.0",
        owner: process.getuid!(),
      };
      await expect(serverToolchainStatus(options)).resolves.toEqual({
        node: {
          version: "26.13.0",
          compatible: true,
          source: "host",
          supportedMajors: [24, 26],
        },
        corepack: { version: "0.36.0", source: "host" },
      });
      await chmod(manifest, 0o666);
      await expect(
        serverToolchainStatus({ ...options, nodeVersion: "22.9.0" }),
      ).resolves.toMatchObject({
        node: { compatible: false },
        corepack: { version: null },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
