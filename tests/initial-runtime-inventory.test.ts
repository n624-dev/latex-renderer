import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  rm,
  chmod,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requireInitialRuntimeInventory } from "../deploy/scripts/server-setup-initial-host.mjs";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const image = `sha256:${"a".repeat(64)}`;
const identity = { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 };
async function fixture(legacy = false) {
  const root = await mkdtemp(join(tmpdir(), "initial-inventory-"));
  roots.push(root);
  const env = join(root, "renderer.env"),
    state = join(root, "state.json"),
    inventory = join(root, "environment");
  await writeFile(env, `RENDERER_IMAGE=${image}\nUNRELATED=preserved\n`);
  if (legacy)
    await writeFile(
      state,
      JSON.stringify({ current: { legacy: true, runtimeImageId: image } }),
    );
  const source = await readFile(
    "deploy/scripts/restore-managed-runtime.sh",
    "utf8",
  );
  const mocks = `
id(){ if [ "$#" = 1 ]; then echo 0; else echo 10000; fi; }
chown(){ :; }
getent(){ printf 'fixture:x:10000:10000::%s:/bin/sh\\n' "$FIXTURE_ROOT"; }
install(){ if [ "$1" = -d ]; then for target; do :; done; command install -d -m 0750 "$target"; else shift 6; command install -m 0640 "$@"; fi; }
runuser(){
 case "$*" in
  *"${image}"*) ;;
  *) echo 'wrong Runtime identity' >&2; return 1;;
 esac
 case "$*" in
  *"image inspect"*) return 0;;
  *"tlmgr info"*) printf 'amsmath\\ntikz\\nluatexja\\n';;
  *"fc-list"*) if [ "\${FAIL_FONTS:-}" = yes ]; then return 1; fi; printf 'Noto Serif CJK JP\\n';;
  *) echo 'unexpected Docker operation' >&2; return 1;;
 esac
}
`;
  const run = (extra: Record<string, string> = {}) =>
    spawnSync("sh", ["-s"], {
      input:
        mocks +
        source.replaceAll(
          "/usr/local/bin/node",
          JSON.stringify(process.execPath),
        ),
      encoding: "utf8",
      timeout: 10000,
      env: {
        ...process.env,
        IMAGE_MANAGER_STATE_FILE: state,
        RENDERER_ENV_FILE: env,
        RENDERER_ENVIRONMENT_ROOT: inventory,
        TMPDIR: join(root, "tmp"),
        FIXTURE_ROOT: root,
        ...extra,
      },
    });
  return { root, env, state, inventory, run };
}
describe.skipIf(process.platform === "win32")(
  "prepared Runtime inventory before first start",
  () => {
    it.each([false, true])(
      "populates the actual configured Runtime with no managed state (legacy=%s)",
      async (legacy) => {
        const f = await fixture(legacy),
          before = await readFile(f.env, "utf8");
        const result = f.run();
        expect(result.status, result.stderr).toBe(0);
        expect(await readFile(f.env, "utf8")).toBe(before);
        expect(
          await readFile(join(f.inventory, "packages.txt"), "utf8"),
        ).toContain("luatexja");
        await expect(
          requireInitialRuntimeInventory(f.inventory, image, identity),
        ).resolves.toBeUndefined();
      },
    );
    it.each([false, true])(
      "clears inherited setgid on first creation and interrupted directories (interrupted=%s)",
      async (interrupted) => {
        const f = await fixture();
        await chmod(f.root, 0o2770);
        if (interrupted) {
          await mkdir(f.inventory);
          await chmod(f.inventory, 0o2700);
        }
        const result = f.run();
        expect(result.status, result.stderr).toBe(0);
        const { stat } = await import("node:fs/promises");
        for (const path of [f.inventory, join(f.root, "tmp")])
          expect((await stat(path)).mode & 0o7777).toBe(0o750);
        await requireInitialRuntimeInventory(f.inventory, image, identity);
      },
    );
    it("preserves prior inventory on generation failure and retries cleanly", async () => {
      const f = await fixture();
      await mkdir(f.inventory);
      for (const name of ["packages.txt", "fonts.txt", "runtime-image.txt"])
        await writeFile(join(f.inventory, name), "old");
      expect(f.run({ FAIL_FONTS: "yes" }).status).not.toBe(0);
      for (const name of ["packages.txt", "fonts.txt", "runtime-image.txt"])
        expect(await readFile(join(f.inventory, name), "utf8")).toBe("old");
      expect(f.run().status).toBe(0);
      await expect(
        requireInitialRuntimeInventory(f.inventory, image, identity),
      ).resolves.toBeUndefined();
    });
    it("blocks successful setup for missing, mismatched, unsafe or empty inventory", async () => {
      const f = await fixture();
      expect(f.run().status).toBe(0);
      await expect(
        requireInitialRuntimeInventory(
          f.inventory,
          `sha256:${"b".repeat(64)}`,
          identity,
        ),
      ).rejects.toThrow("does not match");
      const fonts = join(f.inventory, "fonts.txt");
      await chmod(fonts, 0o666);
      await expect(
        requireInitialRuntimeInventory(f.inventory, image, identity),
      ).rejects.toThrow("unsafe");
      await chmod(fonts, 0o640);
      await writeFile(fonts, "");
      await expect(
        requireInitialRuntimeInventory(f.inventory, image, identity),
      ).rejects.toThrow("empty");
      await rm(fonts);
      await symlink(join(f.inventory, "packages.txt"), fonts);
      await expect(
        requireInitialRuntimeInventory(f.inventory, image, identity),
      ).rejects.toThrow();
      await rm(fonts);
      await expect(
        requireInitialRuntimeInventory(f.inventory, image, identity),
      ).rejects.toThrow();
    });
    it("refuses mutable bootstrap refs and corrupt state without changing inventories", async () => {
      const f = await fixture();
      await writeFile(f.env, "RENDERER_IMAGE=runtime:latest\n");
      expect(f.run().status).not.toBe(0);
      await writeFile(f.state, "broken");
      expect(f.run().status).not.toBe(0);
    });
  },
);
