import { afterEach, describe, expect, it, vi } from "vitest";
import { loadWorkerConfig } from "../apps/renderer-worker/src/config.js";
import {
  rendererRunArguments,
  validateDockerIsolation,
  validateDockerMemoryLimits,
} from "../apps/renderer-worker/src/docker.js";
afterEach(() => vi.unstubAllEnvs());
describe("renderer worker config", () => {
  it("separates a 500MiB start condition from 2GiB RAM and an additional 1GiB swap ceiling", () => {
    stubRequiredEnvironment();
    vi.stubEnv("RENDERER_MIN_AVAILABLE_MEMORY_BYTES", String(500 * 1024 ** 2));
    vi.stubEnv("RENDERER_MEMORY_MAX_BYTES", String(2 * 1024 ** 3));
    vi.stubEnv("RENDERER_SWAP_MAX_BYTES", String(1024 ** 3));
    const config = loadWorkerConfig();
    expect(config.minimumAvailableMemoryBytes).toBe(500 * 1024 ** 2);
    const args = rendererRunArguments(config, "job_test", "/input", "/output");
    expect(args[args.indexOf("--memory") + 1]).toBe(String(2 * 1024 ** 3));
    expect(args[args.indexOf("--memory-swap") + 1]).toBe(String(3 * 1024 ** 3));
    expect(args).not.toContain("--oom-kill-disable");
  });
  it("keeps a preview's RAM ceiling bounded while allowing its configured additional swap", () => {
    stubRequiredEnvironment();
    vi.stubEnv("RENDERER_MEMORY_MAX_BYTES", String(2 * 1024 ** 3));
    vi.stubEnv("RENDERER_SWAP_MAX_BYTES", String(512 * 1024 ** 2));
    const args = rendererRunArguments(
      loadWorkerConfig(),
      "job_test",
      "/input",
      "/output",
      "main.tex",
      ["pdf"],
      1,
      { mode: "preview", pdfDirectory: "/pdf", page: 1 },
    );
    expect(args[args.indexOf("--memory") + 1]).toBe("256m");
    expect(args[args.indexOf("--memory-swap") + 1]).toBe(
      String(768 * 1024 ** 2),
    );
  });
  it.each([
    ["RENDERER_MEMORY_MAX_BYTES", "0"],
    ["RENDERER_MEMORY_MAX_BYTES", String(64 * 1024 ** 2)],
    ["RENDERER_MEMORY_MAX_BYTES", String(129 * 1024 ** 2)],
    ["RENDERER_SWAP_MAX_BYTES", "-1"],
    ["RENDERER_SWAP_MAX_BYTES", "1"],
    ["RENDERER_SWAP_MAX_BYTES", String(2 ** 53 - 64 * 1024 ** 2)],
  ])("rejects an invalid or unbounded budget %s=%s", (key, value) => {
    stubRequiredEnvironment();
    vi.stubEnv(key, value);
    expect(() => loadWorkerConfig()).toThrow();
  });
  it("requires actual daemon memory and swap-limit support instead of trusting CLI flags alone", () => {
    expect(() => validateDockerMemoryLimits("true true\n")).not.toThrow();
    for (const value of ["", "false true", "true false", "false false"])
      expect(() => validateDockerMemoryLimits(value)).toThrow(
        "limit enforcement",
      );
  });
  it("bounds Source tree storage and allows disabling it without changing ZIP limits", () => {
    stubRequiredEnvironment();
    expect(loadWorkerConfig()).toMatchObject({
      sourceTreeMaxBytes: 64 * 1024 ** 2,
      sourceTreeUserMaxBytes: 32 * 1024 ** 2,
      sourceTreeTtlMs: 21600000,
    });
    vi.stubEnv("SOURCE_TREE_MAX_BYTES", "1");
    expect(() => loadWorkerConfig()).toThrow("SOURCE_TREE_USER_MAX_BYTES");
    vi.stubEnv("SOURCE_TREE_MAX_BYTES", "0");
    expect(loadWorkerConfig().sourceTreeMaxBytes).toBe(0);
    vi.stubEnv("SOURCE_TREE_TTL_SECONDS", "0");
    expect(() => loadWorkerConfig()).toThrow("SOURCE_TREE_TTL_SECONDS");
  });
  it("validates host admission headroom and long-wait notice interval", () => {
    stubRequiredEnvironment();
    vi.stubEnv("RENDERER_MIN_AVAILABLE_MEMORY_BYTES", "0");
    expect(() => loadWorkerConfig()).toThrow(
      /RENDERER_MIN_AVAILABLE_MEMORY_BYTES/,
    );
    vi.stubEnv("RENDERER_MIN_AVAILABLE_MEMORY_BYTES", "1024");
    vi.stubEnv("RENDERER_ADMISSION_WAIT_SECONDS", "86401");
    expect(() => loadWorkerConfig()).toThrow(/RENDERER_ADMISSION_WAIT_SECONDS/);
  });
  it("uses the same bounded memory and no-swap budget for an observed lightweight Job", () => {
    stubRequiredEnvironment();
    const config = {
      ...loadWorkerConfig(),
      containerMemoryBytes: 576 * 1024 ** 2,
    };
    const args = rendererRunArguments(config, "job_test", "/input", "/output");
    expect(args[args.indexOf("--memory") + 1]).toBe(
      String(config.containerMemoryBytes),
    );
    expect(args[args.indexOf("--memory-swap") + 1]).toBe(
      String(config.containerMemoryBytes),
    );
  });
  it.each([
    0,
    -1,
    63 * 1024 ** 2,
    129 * 1024 ** 2,
    1088 * 1024 ** 2,
    NaN,
    Infinity,
  ])("rejects an invalid worker-selected cap %s", (containerMemoryBytes) => {
    stubRequiredEnvironment();
    expect(() =>
      rendererRunArguments(
        { ...loadWorkerConfig(), containerMemoryBytes },
        "job_test",
        "/input",
        "/output",
      ),
    ).toThrow("memory cap");
  });
  it("rejects mutable images", () => {
    stubRequiredEnvironment("latest");
    vi.stubEnv("ALLOW_MUTABLE_RENDERER_IMAGE", "");
    expect(() => loadWorkerConfig()).toThrow(/immutable|mutable tags/);
  });
  it("uses a 420 second job timeout and no AppArmor profile by default", () => {
    stubRequiredEnvironment();
    vi.stubEnv("RENDERER_APPARMOR_PROFILE", "");
    const config = loadWorkerConfig();
    expect(config.jobTimeoutMs).toBe(420_000);
    expect(config.apparmorProfile).toBeUndefined();
  });
  it("loads one validated ZIP limit set for worker extraction", () => {
    stubRequiredEnvironment();
    vi.stubEnv("MAX_UPLOAD_BYTES", "1024");
    vi.stubEnv("MAX_EXTRACTED_BYTES", "4096");
    vi.stubEnv("MAX_FILE_COUNT", "7");
    vi.stubEnv("MAX_ZIP_ENTRIES", "9");
    expect(loadWorkerConfig()).toMatchObject({
      maxUploadBytes: 1024,
      maxExtractedBytes: 4096,
      maxFileCount: 7,
      maxZipEntries: 9,
    });
  });
  it("rejects contradictory ZIP limits at startup", () => {
    stubRequiredEnvironment();
    vi.stubEnv("MAX_FILE_COUNT", "10");
    vi.stubEnv("MAX_ZIP_ENTRIES", "9");
    expect(() => loadWorkerConfig()).toThrow(/MAX_ZIP_ENTRIES/);
  });
  it("rejects disabled SVG safety limits", () => {
    stubRequiredEnvironment();
    vi.stubEnv("MAX_SVG_OBJECTS", "0");
    expect(() => loadWorkerConfig()).toThrow(/integer from 1/);
  });
  it("does not pass an AppArmor option for the rootless production configuration", () => {
    stubRequiredEnvironment();
    vi.stubEnv("RENDERER_APPARMOR_PROFILE", "");
    const args = rendererRunArguments(
      loadWorkerConfig(),
      "job_test",
      "/input",
      "/output",
    );
    expect(args).not.toContain("apparmor=latex-renderer");
    expect(args).toContain("seccomp=/tmp/seccomp");
  });
  it("names renderer containers by fenced lease generation", () => {
    stubRequiredEnvironment();
    const args = rendererRunArguments(
      loadWorkerConfig(),
      "job_test",
      "/input",
      "/output",
      "main.tex",
      ["pdf"],
      7,
    );
    expect(args).toContain("latex-render-job_test-g7");
    expect(args).toContain("latex-renderer.lease-generation=7");
  });
  it("bounds a page conversion sandbox without changing normal renderer memory", () => {
    stubRequiredEnvironment();
    const config = loadWorkerConfig();
    const args = rendererRunArguments(
      config,
      "job_test",
      "/input",
      "/output",
      "main.tex",
      ["pdf"],
      7,
      { mode: "preview", page: 2, pdfDirectory: "/checkpoint" },
    );
    expect(args[args.indexOf("--memory") + 1]).toBe("256m");
    expect(args[args.indexOf("--memory-swap") + 1]).toBe("256m");
    expect(args[args.indexOf("--network") + 1]).toBe("none");
    expect(args).toContain("--read-only");
    expect(args).toContain("LATEX_PREVIEW_PAGE=2");
    expect(args).toContain("LATEX_RENDER_STAGE=preview");
    expect(args).toContain("fsize=10485760:10485760");
    expect(args).toContain("type=bind,src=/checkpoint,dst=/work/pdf,readonly");
    expect(args).toContain("no-new-privileges");
    expect(args).toContain("seccomp=/tmp/seccomp");
    const normal = rendererRunArguments(
      config,
      "job_test",
      "/input",
      "/output",
    );
    expect(normal[normal.indexOf("--memory") + 1]).toBe("1g");
    expect(normal[normal.indexOf("--memory-swap") + 1]).toBe("1g");
    expect(
      normal.some((value) => value.startsWith("LATEX_PREVIEW_PAGE=")),
    ).toBe(false);
  });
  it.each([undefined, 0, -1, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid preview page %s",
    (page) => {
      stubRequiredEnvironment();
      expect(() =>
        rendererRunArguments(
          loadWorkerConfig(),
          "job_test",
          "/input",
          "/output",
          "main.tex",
          ["pdf"],
          1,
          {
            mode: "preview",
            ...(page === undefined ? {} : { page }),
            pdfDirectory: "/checkpoint",
          },
        ),
      ).toThrow("Invalid preview page");
    },
  );
  it.each(["svg", "preview"] as const)(
    "requires a read-only checkpoint for %s",
    (mode) => {
      stubRequiredEnvironment();
      expect(() =>
        rendererRunArguments(
          loadWorkerConfig(),
          "job_test",
          "/input",
          "/output",
          "main.tex",
          ["pdf"],
          1,
          { mode, page: 1 },
        ),
      ).toThrow("immutable PDF checkpoint");
    },
  );
  it("rejects AppArmor when Docker is rootless", () => {
    expect(() =>
      validateDockerIsolation(
        '["name=seccomp","name=rootless"]',
        "latex-renderer",
        false,
      ),
    ).toThrow(/unsupported by rootless/);
  });
  it("accepts the hardened rootless production options", () => {
    expect(() =>
      validateDockerIsolation(
        '["name=seccomp","name=rootless","name=cgroupns"]',
        undefined,
        false,
      ),
    ).not.toThrow();
  });
  it("requires AppArmor support when a rootful development daemon is explicitly allowed", () => {
    expect(() =>
      validateDockerIsolation('["name=seccomp"]', "latex-renderer", true),
    ).toThrow(/does not support AppArmor/);
    expect(() =>
      validateDockerIsolation(
        '["name=apparmor","name=seccomp"]',
        "latex-renderer",
        true,
      ),
    ).not.toThrow();
  });
});

function stubRequiredEnvironment(image = "sha256:" + "a".repeat(64)): void {
  vi.stubEnv("DATABASE_PATH", "/tmp/db");
  vi.stubEnv("STORAGE_ROOT", "/tmp/storage");
  vi.stubEnv("RENDERER_IMAGE", image);
  vi.stubEnv("RENDERER_SECCOMP_PROFILE", "/tmp/seccomp");
}
