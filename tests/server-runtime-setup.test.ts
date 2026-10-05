import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadResourceLimits } from "@latex-renderer/shared";
import { loadWorkerConfig } from "../apps/renderer-worker/src/config.js";
import {
  importServerSetupReview,
  importServerRuntimeReview,
  validateServerSetupReview,
  serverSetupReviewEnvironment,
  reviewServerSetupReadiness,
  checkServerSetupOidc,
  SERVER_RUNTIME_LIMITS,
} from "../packages/server-setup-core/src/index.mjs";
import {
  AuthenticationChangeStore,
  applyServerSetupChange,
  applyAuthenticationChange,
  recoverAuthenticationChange,
  serverSetupChangeReview,
  serverSetupUnits,
  type AuthenticationChangeHost,
} from "../deploy/scripts/authentication-change.mjs";
import { checkAuthenticationHealth } from "../deploy/scripts/configure-authentication.mjs";

const before = [
  "# operator annotation",
  "DEPLOYMENT_MODE=standalone",
  "AUTH_MODE=password",
  "PUBLIC_ORIGIN=https://renderer.example.test",
  "RENDERER_PUBLIC_URL=https://renderer.example.test",
  "DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3",
  "STORAGE_ROOT=/var/lib/latex-renderer/storage",
  `RENDERER_IMAGE=sha256:${"a".repeat(64)}`,
  "RENDERER_SECCOMP_PROFILE=/etc/latex-renderer/seccomp.json",
  "PRIVATE_MARKER=never-export-this-fixture-marker",
  "API_KEY_PEPPER_FILE=/private/fixture-secret-path",
  "JOB_HISTORY_RETENTION_DAYS=73",
  "",
].join("\n");
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true });
});
function candidate() {
  const model = structuredClone(importServerSetupReview(before));
  return {
    ...model,
    runtime: {
      ...model.runtime,
      limits: {
        ...model.runtime.limits,
        maxUploadBytes: 31 * 1024 ** 2,
        maxOutputBytes: 270 * 1024 ** 2,
        maxQueueLength: 42,
      },
    },
  };
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "server-runtime-setup-"));
  directories.push(directory);
  await chmod(directory, 0o700);
  const environmentPath = join(directory, "renderer.env"),
    root = join(directory, "state");
  await writeFile(environmentPath, before, { mode: 0o640 });
  await chmod(environmentPath, 0o640);
  const store = new AuthenticationChangeStore(
    environmentPath,
    root,
    process.getuid?.() ?? 0,
    process.getgid?.() ?? 0,
  );
  const active = new Set<string>(serverSetupUnits),
    events: string[] = [];
  const host: AuthenticationChangeHost = {
    active: (unit) => active.has(unit),
    run: (action, unit) => {
      events.push(`${action}:${unit}`);
      if (action === "stop") active.delete(unit);
      else active.add(unit);
    },
    preflight: (contents) => {
      importServerSetupReview(contents);
      events.push("preflight");
    },
    health: async (contents) => {
      expect(await store.environment()).toBe(contents);
      events.push("health");
    },
  };
  return {
    directory,
    environmentPath,
    root,
    store,
    active,
    events,
    host,
    ...serverSetupChangeReview(before, candidate()),
  };
}

describe("server setup runtime review", () => {
  it("imports actual runtime defaults, exports all reviewed limits and retains immutable identity", () => {
    const model = importServerSetupReview(before);
    expect(model.format).toBe(4);
    expect(model.runtime.limits).toMatchObject({
      maxUploadBytes: 20971520,
      maxQueueLength: 100,
      minFreeStorageBytes: 5368709120,
      jobTimeoutSeconds: 420,
    });
    expect(model.deployment.ingress).toBeNull();
    expect(Object.isFrozen(model.runtime.limits)).toBe(true);
    expect(JSON.stringify(model)).not.toMatch(
      /PRIVATE_MARKER|never-export|fixture-secret-path|JOB_HISTORY/,
    );
    const values = serverSetupReviewEnvironment(model);
    expect(values.get("RENDERER_IMAGE")).toBe(`sha256:${"a".repeat(64)}`);
    expect(
      importServerSetupReview(
        [...values].map(([key, value]) => `${key}=${value}`).join("\n"),
      ),
    ).toEqual(model);
  });
  it.each([before, serverSetupChangeReview(before, candidate()).after])(
    "agrees with the actual shared and worker loaders",
    (contents) => {
      const model = importServerSetupReview(contents);
      const values = Object.fromEntries(serverSetupReviewEnvironment(model));
      for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
      vi.stubEnv(
        "RENDERER_SECCOMP_PROFILE",
        "/etc/latex-renderer/seccomp.json",
      );
      const worker = loadWorkerConfig();
      expect(loadResourceLimits(values)).toEqual({
        maxUploadBytes: model.runtime.limits.maxUploadBytes,
        maxExtractedBytes: model.runtime.limits.maxExtractedBytes,
        maxFileCount: model.runtime.limits.maxFileCount,
        maxZipEntries: model.runtime.limits.maxZipEntries,
      });
      for (const name of [
        "maxOutputBytes",
        "maxOutputFileCount",
        "maxOutputDirectoryCount",
        "maxLogBytes",
        "maxSvgObjects",
        "maxSvgBytes",
        "maxSvgTotalBytes",
        "svgConversionTimeoutSeconds",
      ] as const)
        expect(worker[name]).toBe(model.runtime.limits[name]);
      expect(worker.jobTimeoutMs).toBe(
        model.runtime.limits.jobTimeoutSeconds * 1000,
      );
      expect(worker.image).toBe(model.runtime.rendererImage);
      expect(worker.storageRoot).toBe(model.runtime.storageRoot);
    },
  );
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "42", null])(
    "rejects invalid numeric limit %s without reflecting input secrets",
    (invalid) => {
      const model = candidate();
      expect(() =>
        validateServerSetupReview({
          ...model,
          runtime: {
            ...model.runtime,
            limits: { ...model.runtime.limits, maxUploadBytes: invalid },
          },
        }),
      ).toThrow(/positive bounded integer/);
    },
  );
  it.each(["01", "", "1e3", "+12", " 42", "42 ", "9007199254740992"])(
    "rejects ambiguous env limit %s",
    (raw) => {
      expect(() =>
        importServerRuntimeReview(before + `MAX_UPLOAD_BYTES=${raw}\n`),
      ).toThrow();
    },
  );
  it("checks all fields, cross-limit ordering and runtime timeout caps", () => {
    const model = candidate();
    for (const name of Object.keys(SERVER_RUNTIME_LIMITS)) {
      const limits = Object.fromEntries(
        Object.entries(model.runtime.limits).filter(([key]) => key !== name),
      );
      expect(() =>
        validateServerSetupReview({
          ...model,
          runtime: { ...model.runtime, limits },
        }),
      ).toThrow();
    }
    for (const override of [
      { maxExtractedBytes: 1 },
      { maxZipEntries: 1 },
      { jobTimeoutSeconds: 86401 },
      { svgConversionTimeoutSeconds: 86401 },
    ])
      expect(() =>
        validateServerSetupReview({
          ...model,
          runtime: {
            ...model.runtime,
            limits: { ...model.runtime.limits, ...override },
          },
        }),
      ).toThrow();
    expect(() =>
      importServerRuntimeReview(
        before + "MAX_UPLOAD_BYTES=1\nMAX_UPLOAD_BYTES=2\n",
      ),
    ).toThrow(/duplicate/);
  });
  it.each([
    "/",
    "relative",
    "/a/../b",
    "/a//b",
    "/a/",
    "/a/./b",
    "/path\nINJECT=yes",
    "/path with space",
  ])("rejects noncanonical path %s", (storageRoot) => {
    const model = candidate();
    expect(() =>
      validateServerSetupReview({
        ...model,
        runtime: { ...model.runtime, storageRoot },
      }),
    ).toThrow(/canonical absolute/);
  });
  it.each([
    "latest",
    "ghcr.io/fixture/renderer:stable",
    `sha256:${"A".repeat(64)}`,
    `image@sha256:${"a".repeat(63)}`,
  ])("rejects mutable or malformed renderer %s", (rendererImage) => {
    const model = candidate();
    expect(() =>
      validateServerSetupReview({
        ...model,
        runtime: { ...model.runtime, rendererImage },
      }),
    ).toThrow(/immutable/);
  });
  it("rejects hidden/accessor/unknown credential fields before reading them", () => {
    const model = candidate(),
      getter = vi.fn();
    for (const invalid of [
      { ...model, oidcClientSecret: "fixture-secret" },
      {
        ...model,
        runtime: {
          ...model.runtime,
          limits: { ...model.runtime.limits, extra: 1 },
        },
      },
      Object.create(model) as unknown,
      Object.defineProperty({ ...model }, "runtime", { get: getter }),
      {
        ...model,
        runtime: {
          ...model.runtime,
          limits: Object.defineProperty(
            { ...model.runtime.limits },
            "maxFileCount",
            { get: getter },
          ),
        },
      },
    ])
      expect(() => validateServerSetupReview(invalid)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  it("diagnoses format 4 offline with the same initial-owner policy, but never claims apply readiness", async () => {
    const model = candidate();
    expect(reviewServerSetupReadiness(model)).toMatchObject({
      review: model,
      readyForApply: false,
      initialOwner: { bootstrapMethod: "password" },
      ingressStatus: "unreviewed",
    });
    const fetchImpl = vi.fn<typeof fetch>();
    expect(await checkServerSetupOidc(model, { fetchImpl })).toEqual({
      status: "not-required",
      metadata: null,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    const run = spawnSync(
      process.execPath,
      ["deploy/scripts/server-setup-review.mjs"],
      {
        cwd: new URL("..", import.meta.url),
        input: JSON.stringify(model),
        encoding: "utf8",
        timeout: 5000,
      },
    );
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({
      review: model,
      readyForApply: false,
    });
  });
});

describe("coordinated authentication and runtime settings transaction", () => {
  it("preserves full private env, sandbox and retention settings and exposes only a hash-bound review", () => {
    const prepared = serverSetupChangeReview(before, candidate());
    expect(prepared.after).toContain("# operator annotation");
    for (const value of [
      "PRIVATE_MARKER=never-export-this-fixture-marker",
      "API_KEY_PEPPER_FILE=/private/fixture-secret-path",
      "JOB_HISTORY_RETENTION_DAYS=73",
      "RENDERER_SECCOMP_PROFILE=/etc/latex-renderer/seccomp.json",
    ])
      expect(prepared.after).toContain(value);
    expect(JSON.stringify(prepared.envelope)).not.toMatch(
      /PRIVATE_MARKER|never-export|fixture-secret-path|JOB_HISTORY/,
    );
    expect(prepared.envelope.format).toBe(2);
  });
  it.each(["databasePath", "storageRoot", "rendererImage"] as const)(
    "refuses %s migrations outside their existing workflows",
    (key) => {
      const model = candidate();
      const value =
        key === "rendererImage"
          ? `sha256:${"b".repeat(64)}`
          : "/different/path";
      expect(() =>
        serverSetupChangeReview(before, {
          ...model,
          runtime: { ...model.runtime, [key]: value },
        }),
      ).toThrow(/cannot move/);
    },
  );
  it("refuses origin/ingress changes and job timeouts beyond the current systemd stop budget", () => {
    const model = candidate();
    expect(() =>
      serverSetupChangeReview(before, {
        ...model,
        deployment: {
          ...model.deployment,
          authentication: {
            ...model.deployment.authentication,
            deployment: {
              ...model.deployment.authentication.deployment,
              publicOrigin: "https://other.example.test",
              rendererPublicUrl: "https://other.example.test",
            },
          },
        },
      }),
    ).toThrow(/deployment or origin/);
    expect(() =>
      serverSetupChangeReview(before, {
        ...model,
        deployment: {
          ...model.deployment,
          ingress: {
            format: 1,
            mode: "standalone",
            publicOrigin: "https://renderer.example.test",
            accessScope: "internet",
            tlsProvider: "custom",
            listenAddress: "0.0.0.0",
          },
        },
      }),
    ).toThrow(/unchanged ingress/);
    expect(() =>
      serverSetupChangeReview(before, {
        ...model,
        runtime: {
          ...model.runtime,
          limits: { ...model.runtime.limits, jobTimeoutSeconds: 841 },
        },
      }),
    ).toThrow(/stop budget/);
  });
  it("journals before stopping, drains worker last, publishes once and checks every consumer before commit", async () => {
    const f = await fixture(),
      run = f.host.run;
    f.host.run = async (action, unit) => {
      expect((await f.store.journal())?.phase).toBe("pending");
      if (action === "stop") expect(await f.store.environment()).toBe(before);
      else {
        expect(
          f.events.filter((event) => event.startsWith("stop:")),
        ).toHaveLength(5);
        expect(await f.store.environment()).toBe(f.after);
      }
      await run(action, unit);
    };
    expect(await applyServerSetupChange(f.store, f.host, f.envelope)).toEqual(
      candidate(),
    );
    expect(f.events.filter((event) => event.startsWith("stop:")).at(-1)).toBe(
      "stop:latex-renderer-worker.service",
    );
    expect(await f.store.journal()).toBeNull();
    expect(f.active.size).toBe(5);
  });
  it.each(["base", "candidate", "env", "inactive", "preflight"])(
    "does not stop consumers for %s review/preflight failure",
    async (kind) => {
      const f = await fixture();
      const envelope = { ...f.envelope };
      if (kind === "base") envelope.baseSha256 = "f".repeat(64);
      if (kind === "candidate") envelope.candidateSha256 = "f".repeat(64);
      if (kind === "env")
        await writeFile(f.environmentPath, before + "OPERATOR_EDIT=yes\n");
      if (kind === "inactive") f.active.delete("latex-renderer-worker.service");
      if (kind === "preflight")
        f.host.preflight = () => {
          throw new Error("fixture missing owner/secret");
        };
      await expect(
        applyServerSetupChange(f.store, f.host, envelope),
      ).rejects.toThrow();
      expect(f.events.some((event) => event.startsWith("stop:"))).toBe(false);
      expect(await f.store.journal()).toBeNull();
    },
  );
  it("does not accept a setup envelope through the old auth-only entry point", async () => {
    const f = await fixture();
    await expect(
      applyAuthenticationChange(f.store, f.host, f.envelope),
    ).rejects.toThrow(/Invalid reviewed/);
    expect(f.events).toEqual([]);
  });
  it("re-reviewed identical settings check readiness without restarting or journaling", async () => {
    const f = await fixture();
    await applyServerSetupChange(f.store, f.host, f.envelope);
    f.events.length = 0;
    const contents = await f.store.environment();
    const next = serverSetupChangeReview(
      contents,
      importServerSetupReview(contents),
    );
    expect(next.after).toBe(contents);
    await applyServerSetupChange(f.store, f.host, next.envelope);
    expect(f.events).toEqual(["preflight", "health"]);
    expect(await f.store.journal()).toBeNull();
  });
  it.each(["health", "ENOSPC", "stop", "start"])(
    "restores old settings and all consumers after %s failure",
    async (kind) => {
      const f = await fixture();
      if (kind === "health")
        f.host.health = (text) => {
          if (text !== before) throw new Error("fixture bad health");
        };
      if (kind === "ENOSPC")
        vi.spyOn(f.store, "replaceEnvironment").mockRejectedValueOnce(
          Object.assign(new Error("fixture"), { code: "ENOSPC" }),
        );
      if (kind === "stop" || kind === "start") {
        const run = f.host.run;
        let injected = false;
        f.host.run = async (action, unit) => {
          if (
            action === kind &&
            unit === "latex-renderer-worker.service" &&
            !injected
          ) {
            injected = true;
            throw new Error("fixture failed worker");
          }
          await run(action, unit);
        };
      }
      await expect(
        applyServerSetupChange(f.store, f.host, f.envelope),
      ).rejects.toThrow(/recovery completed/);
      expect(await f.store.environment()).toBe(before);
      expect(await f.store.journal()).toBeNull();
      expect(f.active.size).toBe(5);
    },
  );
  it.each(["before", "after"])(
    "recovers interrupted %s publication at boot without starting units",
    async (phase) => {
      const f = await fixture();
      await f.store.initialize();
      await f.store.saveJournal({
        format: 2,
        phase: "pending",
        before,
        after: f.after,
      });
      if (phase === "after") await f.store.replaceEnvironment(f.after);
      f.active.clear();
      const reopened = new AuthenticationChangeStore(
        f.environmentPath,
        f.root,
        f.store.uid,
        f.store.gid,
      );
      expect(await recoverAuthenticationChange(reopened, f.host, true)).toBe(
        true,
      );
      expect(await reopened.environment()).toBe(before);
      expect(f.events).toEqual([]);
      expect(await reopened.journal()).toBeNull();
    },
  );
  it("refuses boot rollback while even the non-auth worker remains active", async () => {
    const f = await fixture();
    await f.store.initialize();
    await f.store.saveJournal({
      format: 2,
      phase: "pending",
      before,
      after: f.after,
    });
    f.active.clear();
    f.active.add("latex-renderer-worker.service");
    await expect(
      recoverAuthenticationChange(f.store, f.host, true),
    ).rejects.toThrow(/stopped consumers/);
    expect(await f.store.journal()).not.toBeNull();
  });
  it("retains durable committed new settings when cleanup is interrupted", async () => {
    const f = await fixture();
    vi.spyOn(f.store, "clear").mockRejectedValueOnce(
      new Error("fixture cleanup interrupted"),
    );
    await expect(
      applyServerSetupChange(f.store, f.host, f.envelope),
    ).rejects.toThrow();
    expect((await f.store.journal())?.phase).toBe("committed");
    f.events.length = 0;
    await recoverAuthenticationChange(f.store, f.host, true);
    expect(await f.store.environment()).toBe(f.after);
    expect(f.events).toEqual([]);
  });
  it("retains recovery state instead of overwriting external edits or a malformed setup journal", async () => {
    const f = await fixture();
    await f.store.initialize();
    await f.store.saveJournal({
      format: 2,
      phase: "pending",
      before,
      after: f.after,
    });
    await writeFile(f.environmentPath, before + "EXTERNAL_EDIT=yes\n");
    await expect(recoverAuthenticationChange(f.store, f.host)).rejects.toThrow(
      /outside the transaction/,
    );
    expect(await f.store.environment()).toContain("EXTERNAL_EDIT");
    await writeFile(
      join(f.root, "journal.json"),
      JSON.stringify({
        format: 2,
        phase: "pending",
        before,
        after: f.after + "EXTERNAL_EDIT=yes\n",
      }),
      { mode: 0o600 },
    );
    await expect(recoverAuthenticationChange(f.store, f.host)).rejects.toThrow(
      /Invalid server setup/,
    );
    expect(f.events).toEqual([]);
  });
  it("recovers an actual SIGKILL after candidate publication using the same boot recovery", async () => {
    const f = await fixture();
    const module = new URL(
      "../deploy/scripts/authentication-change.mjs",
      import.meta.url,
    ).href;
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { AuthenticationChangeStore, applyServerSetupChange, serverSetupUnits } from ${JSON.stringify(module)};
      const store = new AuthenticationChangeStore(${JSON.stringify(f.environmentPath)}, ${JSON.stringify(f.root)}, process.getuid(), process.getgid());
      const active = new Set(serverSetupUnits);
      await applyServerSetupChange(store, { active: u => active.has(u), preflight: () => {}, run: (a,u) => a === 'stop' ? active.delete(u) : active.add(u), health: t => { if(t !== ${JSON.stringify(before)}) process.kill(process.pid, 'SIGKILL'); } }, ${JSON.stringify(f.envelope)});
    `,
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(child.signal).toBe("SIGKILL");
    expect(await f.store.environment()).toBe(f.after);
    f.active.clear();
    await recoverAuthenticationChange(f.store, f.host, true);
    expect(await f.store.environment()).toBe(before);
  });
  it("rejects a FIFO immediately instead of blocking on a substituted configuration file", async () => {
    const f = await fixture(),
      fifo = join(f.directory, "fifo.env");
    const created = spawnSync("mkfifo", ["-m", "640", fifo], {
      encoding: "utf8",
      timeout: 2000,
    });
    expect(created.status).toBe(0);
    const module = new URL(
      "../deploy/scripts/authentication-change.mjs",
      import.meta.url,
    ).href;
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { AuthenticationChangeStore } from ${JSON.stringify(module)};
      const store = new AuthenticationChangeStore(${JSON.stringify(fifo)}, ${JSON.stringify(f.root)}, process.getuid(), process.getgid());
      try { await store.environment(); process.exit(2); } catch { process.exit(0); }
    `,
      ],
      { encoding: "utf8", timeout: 2000 },
    );
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
  });
  it("rejects unexpected special permission bits rather than checking only rwx bits", async () => {
    const f = await fixture();
    await chmod(f.environmentPath, 0o4640);
    await expect(f.store.environment()).rejects.toThrow(
      /Unsafe authentication/,
    );
    expect(f.events).toEqual([]);
  });
  it("orders boot recovery before all selected consumers without exposing new sudo operations", async () => {
    const recovery = await readFile(
      new URL(
        "../deploy/systemd/latex-renderer-authentication-recovery.service",
        import.meta.url,
      ),
      "utf8",
    );
    for (const unit of serverSetupUnits) expect(recovery).toContain(unit);
    const api = await readFile(
      new URL("../deploy/systemd/latex-renderer-api.service", import.meta.url),
      "utf8",
    );
    expect(api).toContain(
      "Requires=latex-renderer-authentication-recovery.service",
    );
  });
  it("checks the real API/internal health shapes and never contacts the web port as an API", async () => {
    const fetchImpl = vi.fn<typeof fetch>((url) => {
      const endpoint = new URL(
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
      );
      if (["3100", "3103"].includes(endpoint.port))
        return Promise.resolve(Response.json({ status: "ok" }));
      return Promise.resolve(
        Response.json({
          backend: "native",
          publicOrigin: "https://renderer.example.test",
          methods: [{ id: "password" }],
        }),
      );
    });
    await checkAuthenticationHealth(before, true, fetchImpl);
    expect(
      fetchImpl.mock.calls.map(([url]) =>
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
      ),
    ).toEqual([
      "http://127.0.0.1:3102/auth/config",
      "http://127.0.0.1:3104/auth/config",
      "http://127.0.0.1:3100/health",
      "http://127.0.0.1:3103/health",
    ]);
    fetchImpl.mockClear();
    await checkAuthenticationHealth(before, false, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it.each(["oversize", "invalid-json", "wrong-origin", "unhealthy-runtime"])(
    "bounds readiness retries and fails closed for %s without exposing response content",
    async (kind) => {
      const fetchImpl = vi.fn<typeof fetch>((url) => {
        const endpoint = new URL(
          typeof url === "string"
            ? url
            : url instanceof URL
              ? url.href
              : url.url,
        );
        if (kind === "oversize")
          return Promise.resolve(new Response("private-marker".repeat(1000)));
        if (kind === "invalid-json")
          return Promise.resolve(new Response("private-marker"));
        if (["3100", "3103"].includes(endpoint.port))
          return Promise.resolve(
            Response.json({ status: "unhealthy", secret: "private-marker" }),
          );
        return Promise.resolve(
          Response.json({
            backend: "native",
            publicOrigin:
              kind === "wrong-origin"
                ? "https://other.example.test"
                : "https://renderer.example.test",
            methods: [{ id: "password" }],
          }),
        );
      });
      const wait = vi.fn(() => Promise.resolve());
      await expect(
        checkAuthenticationHealth(before, true, fetchImpl, wait),
      ).rejects.toThrow("Authentication policy readiness failed");
      expect(wait).toHaveBeenCalledTimes(9);
      expect(wait).toHaveBeenCalledWith(500);
      expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(40);
    },
  );
});
