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

it.skipIf(process.getuid === undefined)(
  "reports trusted installed APT metadata for managed copies and identifies downgrades",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "toolchain-apt-status-"));
    try {
      const managedRoot = join(root, "managed");
      const nodePath = join(managedRoot, "bin", "node");
      const corepackPath = join(managedRoot, "corepack", "dist", "corepack.js");
      const aptManifestPath = join(root, "node-runtime.json");
      await mkdir(join(managedRoot, "bin"), { recursive: true });
      await mkdir(join(managedRoot, "corepack", "dist"), { recursive: true });
      await writeFile(nodePath, "not executable");
      await writeFile(corepackPath, "not executable");
      await writeFile(
        join(managedRoot, "corepack", "package.json"),
        JSON.stringify({ name: "corepack", version: "0.36.0" }),
        { mode: 0o644 },
      );
      const options = {
        managedRoot: managedRoot + "/",
        nodePath,
        corepackPath,
        aptManifestPath,
        nodeVersion: "26.13.0",
        owner: process.getuid!(),
      };
      expect((await serverToolchainStatus(options)).apt).toBeUndefined();
      for (const [version, corepack, status] of [
        ["26.13.1", "0.36.0", "available"],
        ["26.13.0", "0.37.0", "available"],
        ["26.13.0", "0.36.0", "current"],
        ["26.12.0", "0.36.0", "incompatible"],
        ["26.13.1", "0.35.0", "incompatible"],
        ["24.22.0", "0.37.0", "incompatible"],
      ]) {
        await writeFile(
          aptManifestPath,
          JSON.stringify({ version, corepack: { version: corepack } }),
          { mode: 0o644 },
        );
        expect((await serverToolchainStatus(options)).apt).toEqual({
          nodeVersion: version,
          corepackVersion: corepack,
          status,
        });
      }
      await writeFile(aptManifestPath, '{"version":"26.14.0-rc.1","corepack":{"version":"0.36.0"}}');
      expect((await serverToolchainStatus(options)).apt).toBeUndefined();
      await writeFile(aptManifestPath, '{"version":"26.14.0","corepack":{"version":"0.36.0"}}');
      await chmod(aptManifestPath, 0o666);
      expect((await serverToolchainStatus(options)).apt).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
