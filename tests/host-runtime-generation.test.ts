import { mkdir, mkdtemp, readFile, readlink, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { isHostRuntimeGeneration, replaceHostRuntimeLink, stageHostRuntime } from "../deploy/scripts/host-runtime-generation.mjs";

it.skipIf(process.getuid === undefined)(
  "stages both verified executables before publishing a generation and switches both with one link",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "host-runtime-generation-"));
    try {
      const source = join(directory, "apt");
      const root = join(directory, "managed");
      const node = join(source, "bin", "node");
      const corepack = join(source, "corepack", "dist", "corepack.js");
      await mkdir(join(source, "bin"), { recursive: true, mode: 0o755 });
      await mkdir(join(source, "corepack", "dist"), { recursive: true, mode: 0o755 });
      await mkdir(root, { mode: 0o755 });
      await writeFile(node, "candidate Node.js", { mode: 0o755 });
      await writeFile(corepack, "candidate Corepack", { mode: 0o644 });
      const options = {
        root,
        library: source,
        nodeVersion: "26.13.1",
        corepackVersion: "0.34.6",
        owner: process.getuid?.() ?? -1,
      };
      await replaceHostRuntimeLink(join(root, "active"), ".");
      await expect(stageHostRuntime({
        ...options,
        verify() { throw new Error("failed probe"); },
      })).rejects.toThrow("failed probe");
      expect(await readdir(root)).toEqual(["active"]);
      expect(await readlink(join(root, "active"))).toBe(".");

      const generation = await stageHostRuntime({
        ...options,
        async verify(files) {
          expect(await readFile(files.node, "utf8")).toBe("candidate Node.js");
          expect(await readFile(files.corepack, "utf8")).toBe("candidate Corepack");
        },
      });
      expect(isHostRuntimeGeneration(generation)).toBe(true);
      expect(isHostRuntimeGeneration("../outside")).toBe(false);
      await replaceHostRuntimeLink(join(root, "active"), generation);
      expect(await readFile(join(root, "active", "bin", "node"), "utf8")).toBe("candidate Node.js");
      expect(await readFile(join(root, "active", "corepack", "dist", "corepack.js"), "utf8")).toBe("candidate Corepack");
      await replaceHostRuntimeLink(join(root, "active"), ".");
      expect(await readlink(join(root, "active"))).toBe(".");

      await symlink(node, join(source, "bin", "untrusted-link"));
      await expect(stageHostRuntime({
        ...options,
        nodeVersion: "26.13.2",
        verify() { throw new Error("must not run"); },
      })).rejects.toThrow("Untrusted file");
      expect((await readdir(root)).sort()).toEqual(["active", generation]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
