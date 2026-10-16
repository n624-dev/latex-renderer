import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDockerFixture } from "../deploy/ci/lifecycle-docker-fixture.mjs";
import { acquireMutationLockForPath } from "../deploy/scripts/mutation-lock.mjs";

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});
const adapter = () => ({
  runDocker: vi.fn<
    (args: readonly string[], timeout: number) => Promise<string>
  >(() => Promise.resolve("")),
  dockerStopVerified: vi.fn<(name: string) => Promise<void>>(() =>
    Promise.resolve(),
  ),
});

describe("fixed CI lifecycle fixtures", () => {
  it("passes metacharacters only as Docker argv data", async () => {
    root = await mkdtemp(join(tmpdir(), "latex-lifecycle-data-"));
    const receipt = join(root, "receipt.json"),
      docker = adapter(),
      command = ["run", '$(touch sentinel);"\n</script>\\', "image"];
    await runDockerFixture(["render", receipt, ...command], docker);
    expect(docker.runDocker).toHaveBeenCalledExactlyOnceWith(command, 60_000);
    expect(JSON.parse(await readFile(receipt, "utf8"))).toEqual({
      draining: false,
      completed: true,
    });
    expect(await readdir(root)).toEqual(["receipt.json"]);
  });

  it("records draining and removes its signal listener after completion", async () => {
    root = await mkdtemp(join(tmpdir(), "latex-lifecycle-drain-"));
    const receipt = join(root, "receipt.json"),
      before = new Set(process.listeners("SIGTERM")),
      docker = adapter();
    docker.runDocker.mockImplementation(() => {
      const listeners = process
        .listeners("SIGTERM")
        .filter((listener) => !before.has(listener));
      expect(listeners).toHaveLength(1);
      (listeners[0] as () => void)();
      return Promise.resolve("");
    });
    await runDockerFixture(["render", receipt, "run", "image"], docker);
    expect(JSON.parse(await readFile(receipt, "utf8"))).toEqual({
      draining: true,
      completed: true,
    });
    expect(new Set(process.listeners("SIGTERM"))).toEqual(before);
  });

  it("keeps failure failed, writes no receipt and restores listeners", async () => {
    root = await mkdtemp(join(tmpdir(), "latex-lifecycle-fail-"));
    const docker = adapter(),
      before = process.listeners("SIGTERM");
    docker.runDocker.mockRejectedValue(new Error("fixture Docker failure"));
    await expect(
      runDockerFixture(["render", join(root, "receipt.json"), "run"], docker),
    ).rejects.toThrow("fixture Docker failure");
    expect(await readdir(root)).toEqual([]);
    expect(process.listeners("SIGTERM")).toEqual(before);
  });

  it("uses verified cleanup rather than generating another executable", async () => {
    const docker = adapter();
    await runDockerFixture(
      ["cleanup", "latex-render-job_ci_fixture-g1"],
      docker,
    );
    expect(docker.dockerStopVerified).toHaveBeenCalledExactlyOnceWith(
      "latex-render-job_ci_fixture-g1",
    );
    expect(docker.runDocker).not.toHaveBeenCalled();
  });

  it.each([
    { args: [] },
    { args: ["other", "value"] },
    { args: ["render", "receipt"] },
    { args: ["cleanup", "id", "extra"] },
  ])("rejects malformed fixture arguments: %j", async ({ args }) => {
    const docker = adapter();
    await expect(runDockerFixture(args, docker)).rejects.toThrow(
      "Invalid lifecycle Docker fixture arguments",
    );
    expect(docker.runDocker).not.toHaveBeenCalled();
    expect(docker.dockerStopVerified).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform !== "linux")(
    "runs the checked-in lock fixture and keeps protection after parent death",
    async () => {
      root = await mkdtemp(join(tmpdir(), "latex-lifecycle-lock-"));
      const path = join(root, 'quoted-"\n.lock'),
        ready = join(root, "ready"),
        program = fileURLToPath(
          new URL("../deploy/ci/lifecycle-lock-fixture.mjs", import.meta.url),
        ),
        owner = spawn(process.execPath, [program, "hold", path, ready], {
          stdio: ["ignore", "pipe", "pipe"],
        });
      let descendant: number | undefined;
      const terminate = (pid: number) => {
        try {
          process.kill(pid, "SIGKILL");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      };
      try {
        let started = false;
        for (let n = 0; n < 200; n++) {
          if ((await readdir(root)).includes("ready")) {
            started = true;
            break;
          }
          await delay(10);
        }
        expect(started).toBe(true);
        const children = (
          await readFile(
            `/proc/${owner.pid}/task/${owner.pid}/children`,
            "utf8",
          )
        )
          .trim()
          .split(/\s+/);
        expect(children).toHaveLength(1);
        descendant = Number(children[0]);
        expect(descendant).toBeGreaterThan(0);
        const exited = once(owner, "exit");
        owner.kill("SIGKILL");
        await exited;
        await expect(acquireMutationLockForPath(path)).rejects.toMatchObject({
          code: "MUTATION_LOCK_BUSY",
        });
        terminate(descendant);
        let free = false;
        for (let n = 0; n < 100; n++) {
          try {
            const lock = await acquireMutationLockForPath(path);
            await lock.release();
            free = true;
            break;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "MUTATION_LOCK_BUSY")
              throw error;
            await delay(10);
          }
        }
        expect(free).toBe(true);
      } finally {
        if (owner.exitCode === null && owner.signalCode === null && owner.pid)
          terminate(owner.pid);
        if (descendant) terminate(descendant);
      }
    },
  );

  it("keeps CI executable source fixed instead of embedding serialized values", async () => {
    const source = await readFile(
      "deploy/ci/mutation-worker-lifecycle-e2e.mjs",
      "utf8",
    );
    expect(source).toContain('"deploy/ci/lifecycle-lock-fixture.mjs"');
    expect(source).toContain('"deploy/ci/lifecycle-docker-fixture.mjs"');
    expect(source).not.toContain("JSON.stringify(args)");
    expect(source).not.toContain("JSON.stringify(lockPath)");
    expect(source).not.toContain("JSON.stringify(receipt)");
    expect(source).not.toContain('"--input-type=module"');
    expect(source).not.toContain("await writeFile(");
  });
});
