import { readFileSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { configureDockerRepository } from "../deploy/ci/docker-repository.mjs";

vi.mock("node:fs/promises", () => ({
  chmod: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

describe("disposable release runner Docker repository", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(readFile).mockResolvedValue(
      "ID=ubuntu\nVERSION_CODENAME=noble\n",
    );
  });

  it("registers the official scoped signing key before refreshing APT", async () => {
    const run = vi.fn();
    await configureDockerRepository(run);
    expect(run.mock.calls[0]).toEqual([
      "/usr/bin/curl",
      expect.arrayContaining([
        "=https",
        "--max-time",
        "60",
        "--retry",
        "2",
        "https://download.docker.com/linux/ubuntu/gpg",
      ]),
    ]);
    expect(chmod).toHaveBeenCalledWith(
      "/etc/apt/keyrings/latex-renderer-ci-docker.asc",
      0o644,
    );
    expect(writeFile).toHaveBeenCalledWith(
      "/etc/apt/sources.list.d/latex-renderer-ci-docker.sources",
      "Types: deb\nURIs: https://download.docker.com/linux/ubuntu\n" +
        "Suites: noble\nComponents: stable\nArchitectures: amd64\n" +
        "Signed-By: /etc/apt/keyrings/latex-renderer-ci-docker.asc\n",
      { mode: 0o644, flag: "wx" },
    );
    expect(run.mock.calls[1]).toEqual(["/usr/bin/apt-get", ["update"]]);
    expect(vi.mocked(writeFile).mock.invocationCallOrder[0]).toBeLessThan(
      run.mock.invocationCallOrder[1] ?? 0,
    );
  });

  it.each([
    "ID=debian\nVERSION_CODENAME=noble\n",
    "ID=ubuntu\nVERSION_CODENAME=jammy\n",
    "ID=ubuntu\nVERSION_CODENAME=noble;command\n",
  ])(
    "rejects unsupported platform metadata before any mutation (%s)",
    async (release) => {
      vi.mocked(readFile).mockResolvedValue(release);
      const run = vi.fn();
      await expect(configureDockerRepository(run)).rejects.toThrow(
        "Ubuntu 24.04",
      );
      expect(run).not.toHaveBeenCalled();
      expect(mkdir).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
    },
  );

  it("stops before source registration when the signing-key download fails", async () => {
    const run = vi.fn(() => {
      throw new Error("TLS/download failure");
    });
    await expect(configureDockerRepository(run)).rejects.toThrow(
      "TLS/download failure",
    );
    expect(writeFile).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("propagates APT signature failures without an insecure retry", async () => {
    const run = vi.fn((program: string) => {
      if (program === "/usr/bin/apt-get") throw new Error("signature failure");
    });
    await expect(configureDockerRepository(run)).rejects.toThrow(
      "signature failure",
    );
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("registers the repository before installing rootless extras, only in CI", () => {
    const provision = readFileSync(
      "deploy/ci/provision-update-host.mjs",
      "utf8",
    );
    expect(
      provision.indexOf("await configureDockerRepository(run)"),
    ).toBeLessThan(provision.indexOf('"docker-ce-rootless-extras"'));
    expect(
      provision.indexOf('"/etc/latex-renderer-ci-host.json"'),
    ).toBeLessThan(provision.indexOf("await configureDockerRepository(run)"));
    expect(
      readFileSync("deploy/scripts/install-host.sh", "utf8"),
    ).not.toContain("configureDockerRepository");
  });
});
