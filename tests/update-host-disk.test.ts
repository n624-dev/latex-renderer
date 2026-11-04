import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  inspectSdkDirectory,
  prepareUpdateHostDisk,
  UPDATE_HOST_MINIMUM_BYTES as minimum,
  UPDATE_HOST_TARGET_BYTES as target,
  type UpdateHostDiskOptions,
} from "../deploy/ci/update-host-disk.mjs";

function fixture(overrides: UpdateHostDiskOptions = {}) {
  return {
    uid: 0,
    environment: {
      GITHUB_ACTIONS: "true",
      RUNNER_ENVIRONMENT: "github-hosted",
      GITHUB_RUN_ID: "123",
    },
    scriptPath: "/home/runner/work/repo/deploy/ci/update-host-disk.mjs",
    exists: vi.fn(() => false),
    inspect: vi.fn(() => "directory" as const),
    available: vi.fn(() => target),
    remove: vi.fn(),
    log: vi.fn(),
    ...overrides,
  };
}

describe("disposable update-host disk preparation", () => {
  it.each([
    { uid: 1000 },
    { environment: {} },
    {
      environment: {
        GITHUB_ACTIONS: "true",
        RUNNER_ENVIRONMENT: "self-hosted",
        GITHUB_RUN_ID: "123",
      },
    },
    {
      environment: {
        GITHUB_ACTIONS: "true",
        RUNNER_ENVIRONMENT: "github-hosted",
        GITHUB_RUN_ID: "bad",
      },
    },
    {
      scriptPath: "/home/ubuntu/latex-renderer/deploy/ci/update-host-disk.mjs",
    },
    { scriptPath: "/home/runner/work/../../ubuntu/script.mjs" },
  ])(
    "refuses non-disposable contexts before measurement or deletion: %j",
    (context) => {
      const options = fixture(context);
      expect(() => prepareUpdateHostDisk(options)).toThrow("disposable");
      expect(options.available).not.toHaveBeenCalled();
      expect(options.remove).not.toHaveBeenCalled();
    },
  );

  it("refuses an existing application before any capacity work", () => {
    const options = fixture({ exists: () => true });
    expect(() => prepareUpdateHostDisk(options)).toThrow("application host");
    expect(options.available).not.toHaveBeenCalled();
    expect(options.remove).not.toHaveBeenCalled();
  });

  it("keeps every SDK on an adequately provisioned runner", () => {
    const options = fixture();
    expect(prepareUpdateHostDisk(options).removedSdkDirectories).toEqual([]);
    expect(options.inspect).not.toHaveBeenCalled();
    expect(options.remove).not.toHaveBeenCalled();
  });

  it("stops after measured free space reaches the guard", () => {
    let free = 14 * 1024 ** 3;
    const options = fixture({
      available: () => free,
      remove: vi.fn(() => {
        free = target;
      }),
    });
    const result = prepareUpdateHostDisk(options);
    expect(result.beforeBytes).toBe(14 * 1024 ** 3);
    expect(result.availableBytes).toBe(target);
    expect(result.removedSdkDirectories).toEqual(["/usr/local/lib/android"]);
    expect(options.remove).toHaveBeenCalledTimes(1);
  });

  it("does not infer reclaimed capacity from deletion success", () => {
    const options = fixture({ available: () => minimum - 1 });
    expect(() => prepareUpdateHostDisk(options)).toThrow(
      "RUNNER_CAPACITY_BLOCKED",
    );
    expect(options.remove).toHaveBeenCalledTimes(6);
    expect(options.log).toHaveBeenCalledWith(
      expect.objectContaining({ availableBytes: minimum - 1 }),
    );
    expect(options.remove).not.toHaveBeenCalledWith("/opt/hostedtoolcache");
  });

  it.each(["unsafe", "mounted", "missing"] as const)(
    "never removes %s directories",
    (state) => {
      const options = fixture({ available: () => 0, inspect: () => state });
      expect(() => prepareUpdateHostDisk(options)).toThrow(
        "RUNNER_CAPACITY_BLOCKED",
      );
      expect(options.remove).not.toHaveBeenCalled();
    },
  );

  it.each([NaN, -1, Infinity])(
    "fails closed for unmeasurable capacity %s",
    (available) => {
      const options = fixture({ available: () => available });
      expect(() => prepareUpdateHostDisk(options)).toThrow("Cannot measure");
      expect(options.remove).not.toHaveBeenCalled();
    },
  );

  it("propagates cleanup failures without provisioning", () => {
    const options = fixture({
      available: () => 0,
      remove: () => {
        throw new Error("ENOSPC");
      },
    });
    expect(() => prepareUpdateHostDisk(options)).toThrow("ENOSPC");
    expect(options.log).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === "win32")(
    "rejects real external symlinks and mount roots",
    () => {
      const root = mkdtempSync(join(tmpdir(), "update-host-disk-"));
      try {
        mkdirSync(join(root, "directory"));
        symlinkSync(join(root, "directory"), join(root, "link"));
        expect(inspectSdkDirectory(join(root, "link"))).toBe("unsafe");
        expect(inspectSdkDirectory(join(root, "directory"))).toBe("directory");
        expect(inspectSdkDirectory(join(root, "missing"))).toBe("missing");
        expect(inspectSdkDirectory("/")).toBe("mounted");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
