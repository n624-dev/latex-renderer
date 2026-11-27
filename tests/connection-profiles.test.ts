import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  clientConnections,
  saveCredential,
} from "../packages/setup-core/src/index.js";

const firstKey = `lrk_${"a".repeat(32)}_${"A".repeat(43)}`;
const otherKey = `lrk_${"b".repeat(32)}_${"B".repeat(43)}`;

it.skipIf(process.platform === "win32")(
  "binds stored keys to explicit origins, preserves legacy keys, and fails closed on an override",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "renderer-profiles-"));
    try {
      const options = { home, env: { XDG_CONFIG_HOME: home } };
      const store = clientConnections(options);
      await saveCredential(firstKey, options);
      await expect(store.resolve()).rejects.toMatchObject({
        code: "CONNECTION_CONFIRMATION_REQUIRED",
      });
      await store.migrate("work", "https://work.example/");
      await store.save("home", "https://home.example:8443/", otherKey);
      await expect(store.resolve()).resolves.toMatchObject({
        origin: "https://work.example",
        apiKey: firstKey,
      });
      expect(await store.list()).toEqual([
        { name: "home", origin: "https://home.example:8443", default: false },
        { name: "work", origin: "https://work.example", default: true },
      ]);
      const overridden = clientConnections({
        ...options,
        env: {
          ...options.env,
          LATEX_RENDER_BASE_URL: "https://different.example",
        },
      });
      await expect(overridden.resolve()).rejects.toMatchObject({
        code: "PROFILE_ORIGIN_CONFLICT",
      });
      await expect(overridden.resolve("home")).resolves.toMatchObject({
        origin: "https://home.example:8443",
        apiKey: otherKey,
      });
      await expect(
        overridden.resolve("home", "https://different.example"),
      ).rejects.toMatchObject({ code: "PROFILE_ORIGIN_CONFLICT" });
      await expect(
        store.save("work", "https://different.example", otherKey),
      ).rejects.toMatchObject({ code: "PROFILE_ORIGIN_CONFLICT" });
      await store.save("work", "https://work.example", otherKey);
      await expect(store.resolve()).resolves.toMatchObject({
        apiKey: otherKey,
      });
      expect(
        await readFile(join(home, "latex-renderer", "credential"), "utf8"),
      ).toBe(firstKey);
      await store.select("home");
      await store.remove("home");
      await expect(store.resolve()).rejects.toMatchObject({
        code: "CONNECTION_CONFIRMATION_REQUIRED",
      });
      await store.select("work");
      await chmod(
        join(home, "latex-renderer", "connections", "profile-work.json"),
        0o644,
      );
      await expect(store.resolve()).rejects.toMatchObject({
        code: "INVALID_PROFILE",
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);
