import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  cleanupBaseIndexProbe,
  dockerObjectMissing,
  registryProbeImage,
} from "../deploy/ci/base-index-cleanup.mjs";

const container = "a".repeat(64);
const image = `sha256:${"b".repeat(64)}`;
const reference = `127.0.0.1:5000/fixture@sha256:${"c".repeat(64)}`;
const missing = (kind: "image" | "container", target: string) =>
  Object.assign(new Error("fixture missing object"), {
    stderr: `Error response from daemon: No such ${kind}: ${target}\n`,
  });

function fixture(delay = 0) {
  let remaining = delay;
  const run = vi.fn<(args: readonly string[], timeoutMs: number) => string>(
    (args) => {
      if (args[0] === "container" && args[1] === "inspect") {
        if (remaining-- > 0) return container;
        throw missing("container", container);
      }
      return "";
    },
  );
  const sleep = vi
    .fn<(ms: number) => Promise<unknown>>()
    .mockResolvedValue(undefined);
  return {
    run,
    sleep,
    options: {
      run,
      sleep,
      container,
      reference,
      imageIds: [image],
      ownsRegistryImage: true,
    },
  };
}

describe("isolated Base index probe cleanup", () => {
  it("confirms container absence before removing its owned registry image", async () => {
    const f = fixture();
    await cleanupBaseIndexProbe(f.options);
    expect(f.run.mock.calls.map(([args]) => args)).toEqual([
      ["container", "rm", "--force", container],
      ["container", "inspect", "--format", "{{.Id}}", container],
      ["image", "rm", reference],
      ["image", "rm", image],
      ["image", "rm", registryProbeImage],
    ]);
    expect(f.run.mock.calls.every(([, timeout]) => timeout === 5000)).toBe(
      true,
    );
  });

  it("waits for delayed removal without forcing image deletion", async () => {
    const f = fixture(2);
    await cleanupBaseIndexProbe(f.options);
    expect(f.sleep.mock.calls).toEqual([[200], [200]]);
    expect(
      f.run.mock.calls.filter(([args]) => args[0] === "container"),
    ).toHaveLength(6);
    expect(
      f.run.mock.calls
        .filter(([args]) => args[0] === "image")
        .some(([args]) => args.includes("--force")),
    ).toBe(false);
  });

  it("fails boundedly with a live container and does not touch its images", async () => {
    const f = fixture(99);
    await expect(cleanupBaseIndexProbe(f.options)).rejects.toThrow(
      "not confirmed",
    );
    expect(f.sleep).toHaveBeenCalledTimes(4);
    expect(f.run.mock.calls.some(([args]) => args[0] === "image")).toBe(false);
  });

  it("does not infer absence from a daemon failure", async () => {
    const f = fixture();
    f.run.mockImplementation(() => {
      throw new Error("fixture daemon unavailable");
    });
    await expect(cleanupBaseIndexProbe(f.options)).rejects.toThrow(
      "daemon unavailable",
    );
    expect(f.run).toHaveBeenCalledTimes(2);
  });

  it("tolerates --rm already removing exactly this container", async () => {
    const f = fixture();
    const original = f.run.getMockImplementation();
    if (!original) throw new Error("Missing fixture runner");
    f.run.mockImplementation((args, timeout) => {
      if (args[1] === "rm" && args[0] === "container")
        throw missing("container", container);
      return original(args, timeout);
    });
    await cleanupBaseIndexProbe(f.options);
    expect(f.run).toHaveBeenCalledWith(
      ["image", "rm", registryProbeImage],
      5000,
    );
  });

  it("preserves pre-existing registry images", async () => {
    const f = fixture();
    await cleanupBaseIndexProbe({ ...f.options, ownsRegistryImage: false });
    expect(
      f.run.mock.calls.some(([args]) => args.includes(registryProbeImage)),
    ).toBe(false);
  });

  it("reconciles a lost rm reply only with independently verified absence", async () => {
    const f = fixture(1);
    const original = f.run.getMockImplementation();
    if (!original) throw new Error("Missing fixture runner");
    f.run.mockImplementation((args, timeout) => {
      if (args[0] === "container" && args[1] === "rm")
        throw new Error("fixture lost rm reply");
      return original(args, timeout);
    });
    await cleanupBaseIndexProbe(f.options);
    expect(f.sleep).toHaveBeenCalledTimes(1);
    expect(f.run).toHaveBeenLastCalledWith(
      ["image", "rm", registryProbeImage],
      5000,
    );
  });

  it.each([{ reference: "ghcr.io/other/image" }, { imageIds: ["--all"] }])(
    "rejects non-fixture image targets %j before cleanup",
    async (invalid) => {
      const f = fixture();
      await expect(
        cleanupBaseIndexProbe({ ...f.options, ...invalid }),
      ).rejects.toThrow("identity");
      expect(f.run).not.toHaveBeenCalled();
    },
  );

  it("ignores only an absent exact fixture image, not conflicts or daemon errors", async () => {
    const f = fixture();
    f.run.mockImplementation((args) => {
      throw missing(
        args[0] === "container" ? "container" : "image",
        args.at(-1) ?? "",
      );
    });
    await cleanupBaseIndexProbe(f.options);
    const g = fixture();
    const original = g.run.getMockImplementation();
    if (!original) throw new Error("Missing fixture runner");
    g.run.mockImplementation((args, timeout) => {
      if (args[0] === "image") throw new Error("fixture image still in use");
      return original(args, timeout);
    });
    await expect(cleanupBaseIndexProbe(g.options)).rejects.toThrow(
      "still in use",
    );
  });

  it.each(["", "--all", "../outside", "f".repeat(63)])(
    "rejects invalid container identity %j before any action",
    async (id) => {
      const f = fixture();
      await expect(
        cleanupBaseIndexProbe({ ...f.options, container: id }),
      ).rejects.toThrow("identity");
      expect(f.run).not.toHaveBeenCalled();
    },
  );

  it("only recognizes an exact missing-object response", () => {
    expect(dockerObjectMissing(missing("image", image), "image", image)).toBe(
      true,
    );
    expect(dockerObjectMissing(missing("image", "other"), "image", image)).toBe(
      false,
    );
    expect(
      dockerObjectMissing(
        new Error("Cannot connect to Docker"),
        "image",
        image,
      ),
    ).toBe(false);
  });

  it("recognizes Docker's exact familiar name for the pinned registry image", () => {
    const familiar = registryProbeImage.slice("docker.io/library/".length);
    expect(
      dockerObjectMissing(
        missing("image", familiar),
        "image",
        registryProbeImage,
      ),
    ).toBe(true);
    for (const other of [
      familiar.replace("registry@", "other@"),
      `registry@sha256:${"0".repeat(64)}`,
      `example.invalid/library/${familiar}`,
      `${familiar}\nCannot connect to Docker`,
    ]) {
      expect(
        dockerObjectMissing(
          missing("image", other),
          "image",
          registryProbeImage,
        ),
      ).toBe(false);
    }
    expect(
      dockerObjectMissing(
        missing("container", familiar),
        "container",
        registryProbeImage,
      ),
    ).toBe(false);
  });

  it("cleans an already absent registry image with Docker's familiar name", async () => {
    const f = fixture();
    const original = f.run.getMockImplementation();
    if (!original) throw new Error("Missing fixture runner");
    f.run.mockImplementation((args, timeout) => {
      if (args[0] === "image" && args.at(-1) === registryProbeImage)
        throw missing(
          "image",
          registryProbeImage.slice("docker.io/library/".length),
        );
      return original(args, timeout);
    });
    await cleanupBaseIndexProbe(f.options);
  });

  it("reports protocol success only after cleanup and preserves combined failure evidence", () => {
    const source = readFileSync("deploy/ci/check-base-index.mjs", "utf8");
    expect(source.lastIndexOf("console.log(")).toBeGreaterThan(
      source.indexOf("await cleanupBaseIndexProbe("),
    );
    expect(source).toContain("[probeFailure, error]");
    expect(source).not.toContain('run(["stop", container])');
    expect(source).toContain(
      'dockerObjectMissing(error, "image", registryImage)',
    );
  });
});
