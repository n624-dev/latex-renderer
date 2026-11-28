import * as fs from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { expect, it, vi } from "vitest";
import { defined } from "./helpers/assert-defined.js";

const hostState = "/var/lib/latex-renderer/update-manager";
const hostReleases = "/opt/latex-renderer/releases";
const version = "7.8.9";
const token = "fixture-update-manager-token-00000000";
const notify = { channel: "stable", mode: "notify" };
const automatic = { ...notify, mode: "automatic" };
type Reply = { status: number; body: unknown };

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function managerFixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "update-manager-persistence-"));
  const statePath = join(root, "state.json");
  const tokenPath = join(root, "token");
  const releasePath = join(root, "releases", "fixture");
  const current = join(root, "current");
  await fs.mkdir(releasePath, { recursive: true });
  await fs.writeFile(
    join(releasePath, "package.json"),
    JSON.stringify({ version }),
  );
  await fs.symlink(`${hostReleases}/fixture`, current);
  await fs.writeFile(tokenPath, token, { mode: 0o600 });

  // Redirect only the fixed host paths. The controller still opens, writes,
  // renames and reloads real files, including its operation journal.
  function local(path: string) {
    if (path.startsWith(`${hostState}/`) || path === hostState)
      return root + path.slice(hostState.length);
    if (path.startsWith(`${hostReleases}/`) || path === hostReleases)
      return join(root, "releases") + path.slice(hostReleases.length);
    if (path === "/opt/latex-renderer/current") return current;
    if (path === "/run/latex-renderer") return root;
    if (path === tokenPath) return path;
    throw new Error(`Unexpected Update Manager path: ${path}`);
  }
  const rename = vi.fn(fs.rename);
  vi.doMock("node:fs/promises", () => ({
    ...fs,
    chmod: (path: string, mode: number) => fs.chmod(local(path), mode),
    lstat: (path: string) => fs.lstat(local(path)),
    mkdir: (path: string, options: Parameters<typeof fs.mkdir>[1]) =>
      fs.mkdir(local(path), options),
    readdir: (path: string, options: Parameters<typeof fs.readdir>[1]) =>
      fs.readdir(local(path), options),
    readFile: (path: string, encoding: BufferEncoding) =>
      fs.readFile(local(path), encoding),
    readlink: (path: string) => fs.readlink(local(path)),
    realpath: async (path: string) => {
      const mapped = local(path);
      const actual = await fs.realpath(mapped);
      return actual === mapped ? path : actual;
    },
    rename: (source: string, destination: string) =>
      rename(local(source), local(destination)),
    rm: (path: string, options: Parameters<typeof fs.rm>[1]) =>
      fs.rm(local(path), options),
    statfs: () => Promise.resolve({ bavail: 10_000_000, bsize: 4096 }),
    unlink: (path: string) => fs.unlink(local(path)),
    writeFile: (
      path: string,
      contents: string,
      options: Parameters<typeof fs.writeFile>[2],
    ) => fs.writeFile(local(path), contents, options),
    open: (path: string, flags: string, mode?: number) =>
      fs.open(local(path), flags, mode),
  }));

  const latest = deferred();
  const refreshStarted = deferred();
  const apply = deferred();
  vi.doMock("../deploy/scripts/github-json.mjs", () => ({
    githubJson: async (url: string) => {
      if (url.includes("/git/ref/"))
        return { object: { type: "commit", sha: "a".repeat(40) } };
      if (url.endsWith("/releases/latest")) {
        refreshStarted.resolve();
        await latest.promise;
      } else {
        expect(url).toMatch(/\/releases\/tags\/v7\.8\.9$/);
        await apply.promise;
      }
      return {
        draft: false,
        prerelease: false,
        immutable: true,
        tag_name: `v${version}`,
        assets: [
          {
            name: `latex-renderer-server-${version}.tar.gz`,
            size: 4096,
            digest: `sha256:${"a".repeat(64)}`,
            browser_download_url: `https://github.com/n624-dev/latex-renderer/releases/download/v${version}/latex-renderer-server-${version}.tar.gz`,
          },
        ],
      };
    },
  }));
  vi.doMock("../deploy/scripts/mutation-lock.mjs", () => ({
    acquireMutationLock: () => ({ release: () => Promise.resolve() }),
  }));
  vi.doMock("../deploy/scripts/server-toolchain-status.mjs", () => ({
    serverToolchainStatus: () => ({}),
  }));
  vi.doMock("../deploy/scripts/updater-status.mjs", async (original) => ({
    ...(await original<
      typeof import("../deploy/scripts/updater-status.mjs")
    >()),
    updaterStatus: () => ({ status: "ready" }),
  }));
  const intervals: ReturnType<typeof setInterval>[] = [];
  vi.doMock("node:timers", async (original) => {
    const timers = await original<typeof import("node:timers")>();
    return {
      ...timers,
      setInterval: (callback: () => void, delay: number) => {
        const interval = timers.setInterval(callback, delay);
        intervals.push(interval);
        return interval;
      },
    };
  });
  let server: Server | undefined;
  let activity: { pending: number } | undefined;
  vi.doMock("../deploy/scripts/http-idle-server.mjs", async (original) => ({
    ...(await original<
      typeof import("../deploy/scripts/http-idle-server.mjs")
    >()),
    // Exercise the actual HTTP dispatcher in process, without a host socket.
    startHttpService: (
      value: Server,
      {
        onListening,
        activity: currentActivity,
      }: { onListening: () => void; activity: { pending: number } },
    ) => {
      server = value;
      activity = currentActivity;
      onListening();
    },
  }));
  vi.stubEnv("UPDATE_MANAGER_TOKEN_FILE", tokenPath);
  vi.stubEnv("UPDATE_MANAGER_STATE_ROOT", hostState);
  vi.stubEnv("UPDATE_RELEASE_ROOT", hostReleases);
  vi.stubEnv("UPDATE_CURRENT_LINK", "/opt/latex-renderer/current");
  vi.stubEnv(
    "UPDATE_MANAGER_SOCKET",
    "/run/latex-renderer/update-manager.sock",
  );
  vi.stubEnv("LISTEN_FDS", "0");
  const clearIntervals = () =>
    intervals.splice(0).forEach((interval) => clearInterval(interval));
  const start = async () => {
    clearIntervals();
    vi.resetModules();
    if (process.getuid?.() === 0)
      vi.spyOn(process, "getuid").mockReturnValueOnce(1000);
    await import("../deploy/scripts/update-manager.mjs");
  };
  return {
    root,
    start,
    rename,
    statePath,
    latest,
    refreshStarted,
    apply,
    async disk(): Promise<Record<string, unknown>> {
      return JSON.parse(await fs.readFile(statePath, "utf8")) as Record<
        string,
        unknown
      >;
    },
    request(path: string, data?: unknown) {
      const input = Object.assign(
        Readable.from(data === undefined ? [] : [JSON.stringify(data)]),
        {
          method: data === undefined ? "GET" : "POST",
          url: `/v1/${path}`,
          headers: { authorization: `Bearer ${token}` },
        },
      );
      return new Promise<Reply>((resolve) => {
        let status = 0;
        defined(server).emit("request", input, {
          writeHead: (code: number) => {
            status = code;
          },
          end: (body: string) =>
            resolve({ status, body: JSON.parse(body) as unknown }),
        });
      });
    },
    async close() {
      latest.resolve();
      apply.resolve();
      clearIntervals();
      try {
        await vi.waitFor(() => expect(activity?.pending ?? 0).toBe(0));
      } finally {
        vi.doUnmock("node:fs/promises");
        vi.doUnmock("node:timers");
        for (const name of [
          "github-json",
          "mutation-lock",
          "server-toolchain-status",
          "updater-status",
          "http-idle-server",
        ])
          vi.doUnmock(`../deploy/scripts/${name}.mjs`);
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  };
}

it("confirms policy requests only after atomic rename and reloads the last confirmed policy", async () => {
  const f = await managerFixture();
  const held = deferred();
  const entered = deferred();
  const pending: Promise<Reply>[] = [];
  try {
    await f.start();
    f.rename.mockClear().mockImplementationOnce(async (source, destination) => {
      expect(destination).toBe(f.statePath);
      expect(JSON.parse(await fs.readFile(source, "utf8"))).toMatchObject({
        policy: automatic,
      });
      entered.resolve();
      await held.promise;
      return fs.rename(source, destination);
    });
    const first = f.request("policy", automatic);
    pending.push(first);
    await Promise.race([
      entered.promise,
      first.then((response) => {
        throw new Error(
          `Policy returned before rename: ${JSON.stringify(response)}`,
        );
      }),
    ]);
    const second = f.request("policy", notify);
    const repeat = f.request("policy", notify);
    pending.push(second, repeat);
    expect(await f.request("state")).toMatchObject({
      status: 200,
      body: { policy: notify },
    });
    expect(await f.disk()).toMatchObject({ policy: notify });
    expect(f.rename).toHaveBeenCalledTimes(1);
    held.resolve();
    expect(await Promise.all(pending)).toEqual([
      { status: 200, body: automatic },
      { status: 200, body: notify },
      { status: 200, body: notify },
    ]);
    expect(f.rename).toHaveBeenCalledTimes(3);
    const persisted = await f.disk();
    expect(persisted).toMatchObject({ policy: notify });
    expect(await f.request("state")).toMatchObject({
      status: 200,
      body: persisted,
    });
    await f.start();
    expect(await f.request("state")).toMatchObject({
      status: 200,
      body: persisted,
    });
  } finally {
    held.resolve();
    await Promise.allSettled(pending);
    await f.close();
  }
});

it("records an interrupted apply on startup without resetting the saved policy", async () => {
  const f = await managerFixture();
  try {
    await f.start();
    expect(await f.request("policy", automatic)).toEqual({
      status: 200,
      body: automatic,
    });
    const id = "updop_1700000000000_interrupted";
    await fs.writeFile(
      f.statePath,
      JSON.stringify({ ...(await f.disk()), lastOperationId: id }),
    );
    await fs.writeFile(
      join(f.root, "operations", `${id}.json`),
      JSON.stringify({ id, type: "apply", status: "running" }),
    );
    await f.start();
    const persisted = await f.disk();
    expect(persisted).toMatchObject({
      policy: automatic,
      lastOperationId: id,
    });
    expect(persisted.lastError).toContain("restarted");
    expect(await f.request("state")).toMatchObject({
      status: 200,
      body: persisted,
    });
    expect(await f.request(`operations/${id}?includeLog=0`)).toMatchObject({
      status: 200,
      body: {
        id,
        status: "failed",
        error: persisted.lastError,
      },
    });
  } finally {
    await f.close();
  }
});

it("preserves policy through refresh, apply bookkeeping and a failed persistence attempt", async () => {
  const f = await managerFixture();
  try {
    await f.start();
    const refresh = f.request("refresh", {});
    await Promise.race([
      f.refreshStarted.promise,
      refresh.then((response) => {
        throw new Error(`Refresh returned early: ${JSON.stringify(response)}`);
      }),
    ]);
    expect(await f.request("policy", automatic)).toEqual({
      status: 200,
      body: automatic,
    });
    const applied = await f.request("apply", { version });
    expect(applied).toMatchObject({
      status: 202,
      body: { status: "running" },
    });
    const id = (applied.body as { id: string }).id;
    expect(id).toMatch(/^updop_/);
    expect(await f.request("policy", notify)).toMatchObject({
      status: 409,
      body: { error: { code: "UPDATE_OPERATION_ACTIVE" } },
    });
    f.latest.resolve();
    expect(await refresh).toMatchObject({
      status: 200,
      body: { status: "up-to-date" },
    });
    f.apply.resolve();
    // The fixture release is already installed. This executes the apply
    // release and terminal state writers without entering host deployment.
    await vi.waitFor(async () => {
      expect(await f.request("activation-state")).toMatchObject({
        status: 200,
        body: {
          activeOperationId: null,
          lastError: `v${version} is already installed`,
        },
      });
    });
    expect(await f.request(`operations/${id}?includeLog=0`)).toMatchObject({
      status: 200,
      body: { id, status: "failed" },
    });
    const committed = await f.disk();
    expect(committed).toMatchObject({
      policy: automatic,
      available: { version },
      lastOperationId: id,
    });
    f.rename.mockImplementationOnce(async (source, destination) => {
      expect(destination).toBe(f.statePath);
      await fs.rm(source);
      return fs.rename(source, destination); // Exercise the real ENOENT path.
    });
    expect(await f.request("policy", notify)).toMatchObject({
      status: 500,
      body: { error: { code: "ENOENT" } },
    });
    expect(await f.disk()).toEqual(committed);
    expect(await f.request("state")).toMatchObject({
      status: 200,
      body: committed,
    });
    await f.start();
    expect(await f.request("state")).toMatchObject({
      status: 200,
      body: committed,
    });
    expect(await f.request(`operations/${id}?includeLog=0`)).toMatchObject({
      status: 200,
      body: { id, status: "failed" },
    });
    expect(await f.request("check", { version })).toMatchObject({
      status: 200,
      body: { version },
    });
    expect(await f.disk()).toMatchObject({
      policy: automatic,
      lastOperationId: id,
      lastError: null,
    });
    expect(await f.request("policy", notify)).toEqual({
      status: 200,
      body: notify,
    });
    expect(await f.disk()).toMatchObject({
      policy: notify,
      lastOperationId: id,
    });
  } finally {
    await f.close();
  }
});
