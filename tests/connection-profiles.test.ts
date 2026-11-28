import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { PUBLIC_ORIGIN } from "@latex-renderer/shared";
import { createMcpOperations } from "../packages/mcp-core/src/index.js";
import { createSetupWebActions } from "../packages/setup-web/src/index.js";
import {
  clientConnections,
  doctorSetup,
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
      await expect(overridden.target()).rejects.toMatchObject({
        code: "PROFILE_ORIGIN_CONFLICT",
      });
      await expect(overridden.target("home")).resolves.toEqual({
        name: "home",
        origin: "https://home.example:8443",
      });
      await expect(overridden.target("new")).resolves.toEqual({
        name: "new",
        origin: "https://different.example",
      });
      await expect(
        overridden.target("home", "https://different.example"),
      ).rejects.toMatchObject({ code: "PROFILE_ORIGIN_CONFLICT" });
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

it.skipIf(process.platform === "win32")(
  "selects the standard origin with or without an environment key and gives explicit profiles precedence",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "renderer-profiles-"));
    try {
      const env = { XDG_CONFIG_HOME: home };
      const store = clientConnections({ home, env });
      const firstOrigin = "https://work.example";
      await store.save("work", firstOrigin, firstKey);
      await store.save("standard", PUBLIC_ORIGIN, otherKey);
      await expect(store.resolve()).resolves.toEqual({
        name: "work",
        origin: firstOrigin,
        apiKey: firstKey,
        credentialSource: "profile",
      });
      const keyFromEnvironment = clientConnections({
        home,
        env: { ...env, LATEX_RENDER_API_KEY: firstKey },
      });
      await expect(keyFromEnvironment.resolve()).resolves.toEqual({
        origin: PUBLIC_ORIGIN,
        apiKey: firstKey,
        credentialSource: "environment",
      });
      await expect(keyFromEnvironment.resolve("standard")).resolves.toEqual({
        name: "standard",
        origin: PUBLIC_ORIGIN,
        apiKey: otherKey,
        credentialSource: "profile",
      });
      const keyAndOriginFromEnvironment = clientConnections({
        home,
        env: {
          ...env,
          LATEX_RENDER_API_KEY: otherKey,
          LATEX_RENDER_BASE_URL: "https://home.example:8443/",
        },
      });
      await expect(keyAndOriginFromEnvironment.resolve()).resolves.toEqual({
        origin: "https://home.example:8443",
        apiKey: otherKey,
        credentialSource: "environment",
      });
      await expect(
        keyAndOriginFromEnvironment.resolve("work"),
      ).resolves.toEqual({
        name: "work",
        origin: firstOrigin,
        apiKey: firstKey,
        credentialSource: "profile",
      });
      await store.select("standard");
      await expect(store.resolve()).resolves.toEqual({
        name: "standard",
        origin: PUBLIC_ORIGIN,
        apiKey: otherKey,
        credentialSource: "profile",
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform === "win32")(
  "uses Setup Web's selected profile, replacement key and deletion in Local MCP",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "renderer-profiles-"));
    try {
      vi.stubEnv("HOME", home);
      vi.stubEnv("XDG_CONFIG_HOME", home);
      vi.stubEnv("LATEX_RENDER_PROFILE", undefined);
      vi.stubEnv("LATEX_RENDER_BASE_URL", undefined);
      vi.stubEnv("LATEX_RENDER_RENDERER_URL", undefined);
      vi.stubEnv("LATEX_RENDER_GATEWAY_URL", undefined);
      vi.stubEnv("LATEX_RENDER_API_KEY", undefined);
      const standard = createSetupWebActions({
        profile: "standard",
        rendererBaseUrl: PUBLIC_ORIGIN,
      });
      const workOrigin = "https://work.example";
      const work = createSetupWebActions({
        profile: "work",
        rendererBaseUrl: workOrigin,
      });
      await standard.saveApiKey(firstKey);
      await work.saveApiKey(otherKey);

      const requests: [string, string | null][] = [];
      vi.stubGlobal("fetch", (url: URL, init?: RequestInit) => {
        expect(url.pathname).toBe("/api/v1/projects");
        requests.push([
          url.origin,
          new Headers(init?.headers).get("Authorization"),
        ]);
        return Promise.resolve(
          Response.json({ items: [], hasMore: false, nextCursor: null }),
        );
      });
      const operations = createMcpOperations();
      await operations.listProjects({});
      vi.stubEnv("LATEX_RENDER_PROFILE", "work");
      vi.stubEnv("LATEX_RENDER_API_KEY", firstKey);
      vi.stubEnv("LATEX_RENDER_BASE_URL", PUBLIC_ORIGIN);
      await operations.listProjects({});
      const replacement = `lrk_${"c".repeat(32)}_${"C".repeat(43)}`;
      await work.saveApiKey(replacement);
      await operations.listProjects({});
      await work.removeApiKey();
      await expect(operations.listProjects({})).rejects.toMatchObject({
        code: "CONNECTION_NOT_FOUND",
      });
      vi.stubEnv("LATEX_RENDER_PROFILE", "standard");
      await operations.listProjects({});
      expect(requests).toEqual([
        [PUBLIC_ORIGIN, `Bearer ${firstKey}`],
        [workOrigin, `Bearer ${otherKey}`],
        [workOrigin, `Bearer ${replacement}`],
        [PUBLIC_ORIGIN, `Bearer ${firstKey}`],
      ]);
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      await rm(home, { recursive: true, force: true });
    }
  },
);

// Product gap: Setup diagnoses an environment credential without showing its origin.
it.fails(
  "reports the effective origin for an environment-only Setup credential",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "renderer-profiles-"));
    try {
      const origin = "https://work.example";
      const diagnostic = await doctorSetup({
        home,
        env: {
          XDG_CONFIG_HOME: home,
          LATEX_RENDER_BASE_URL: origin,
          LATEX_RENDER_API_KEY: firstKey,
        },
      });
      const credential = diagnostic.checks.find(
        ({ id }) => id === "credential",
      );
      expect(credential?.message).not.toContain(firstKey);
      expect(credential?.message).toContain(origin);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);
