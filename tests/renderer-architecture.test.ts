import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it.skipIf(process.platform === "win32").each([
  ["amd64", "x86_64-linux"],
  ["x86_64", "x86_64-linux"],
  ["arm64", "aarch64-linux"],
  ["aarch64", "aarch64-linux"],
])(
  "generates a complete, single-native-architecture %s Base profile",
  (architecture, binary) => {
    const root = mkdtempSync(join(tmpdir(), "renderer-arch-"));
    try {
      writeFileSync(
        join(root, "database.xz"),
        execFileSync("xz", ["-c"], {
          input:
            "name scheme-full\ndepend collection-basic\ndepend collection-latexextra\ndepend collection-langenglish\ndepend collection-langjapanese\n\n",
        }),
      );
      writeFileSync(
        join(root, "curl"),
        '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = --output ]; then cp "$ARCH_FIXTURE/database.xz" "$2"; exit; fi; shift; done\nexit 90\n',
        { mode: 0o700 },
      );
      const result = spawnSync(
        "sh",
        [
          "deploy/scripts/generate-texlive-profile.sh",
          "https://example.invalid/tlnet",
          join(root, "profile"),
          architecture,
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${root}:${process.env.PATH}`,
            ARCH_FIXTURE: root,
          },
        },
      );
      expect(result.status, result.stderr).toBe(0);
      const profile = readFileSync(join(root, "profile"), "utf8");
      expect(profile.match(/^binary_.+$/gm)).toEqual([`binary_${binary} 1`]);
      expect(profile).toContain("collection-basic 1\n");
      expect(profile).toContain("collection-latexextra 1\n");
      expect(profile).not.toMatch(/^collection-lang/m);
      expect(profile).toContain("tlpdbopt_install_docfiles 0");
      expect(profile).toContain("tlpdbopt_install_srcfiles 0");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform === "win32")(
  "rejects unsupported architectures before downloads or output mutation",
  () => {
    const result = spawnSync(
      "sh",
      [
        "deploy/scripts/generate-texlive-profile.sh",
        "https://example.invalid/tlnet",
        "/not-used",
        "armv7",
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("Unsupported TeX Live architecture");
  },
);

it("keeps ARM validation native, non-publishing and separate from immutable dated publication", () => {
  const ci = readFileSync(".github/workflows/renderer-image.yml", "utf8"),
    native = readFileSync(".github/workflows/ci.yml", "utf8"),
    daily = readFileSync(".github/workflows/renderer-image-daily.yml", "utf8"),
    base = readFileSync("renderer/Dockerfile.base", "utf8");
  expect(ci).toContain("options: [amd64, arm64]");
  expect(ci).toContain("ubuntu-24.04-arm");
  expect(ci).toContain('"$CI_ARCHITECTURE"');
  expect(ci).toContain("push: false");
  expect(ci).not.toContain("packages: write");
  expect(ci).not.toContain("setup-qemu");
  expect(native).toContain("runs-on: ubuntu-24.04-arm");
  expect(native).toContain(
    "Native API, SQLite, setup, update and recovery regression tests",
  );
  expect(daily).toContain("runs-on: ubuntu-24.04");
  expect(daily).not.toContain("--platform linux/arm64");
  expect(base).toContain("arm64) texlive_arch=aarch64-linux");
  expect(base).toContain('test -x "/opt/texlive/2026/bin/$texlive_arch/tlmgr"');
  expect(base).toContain(
    '"/opt/texlive/2026/bin/$texlive_arch/tlmgr" option repository',
  );
  expect(base).not.toMatch(/^.*ln -s.*\/opt\/texlive\/2026\/bin\//m);
  expect(base).toContain(
    'ENV PATH="/opt/texlive/2026/bin/x86_64-linux:/opt/texlive/2026/bin/aarch64-linux:${PATH}"',
  );
});

it.skipIf(process.platform === "win32").each(["x86_64-linux", "aarch64-linux"])(
  "resolves the installed %s binaries without adding a TeX Live alias",
  (binary) => {
    const root = mkdtempSync(join(tmpdir(), "renderer-path-"));
    try {
      const base = readFileSync("renderer/Dockerfile.base", "utf8");
      const path = /^ENV PATH="([^"\n]+)"$/m.exec(base)?.[1];
      if (!path) throw new Error("Missing Base binary PATH");
      const directory = join(root, "opt/texlive/2026/bin", binary);
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, "tlmgr"),
        `#!/bin/sh\nprintf '%s\\n' '${binary}'\n`,
        { mode: 0o700 },
      );
      const result = spawnSync("sh", ["-c", "tlmgr"], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: path
            .replaceAll("/opt/texlive/", `${root}/opt/texlive/`)
            .replace("${PATH}", process.env.PATH ?? "/usr/bin:/bin"),
        },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe(binary);
      expect(existsSync(join(root, "opt/texlive/2026/bin/native"))).toBe(false);
      // Integrity validation must remain mandatory after both install attempts.
      const install = readFileSync(
        "renderer/install-language-packages.sh",
        "utf8",
      );
      expect(install.match(/&& tlmgr check files/g)).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform === "win32").each([
  [
    "x86_64",
    "amd64",
    "f29324fe934d1e100617484c78deef803c4dc2cd351d645bbde42e96b4fccc5e",
  ],
  [
    "aarch64",
    "arm64",
    "4bcfd35521a7cbc545ebfd5d57334a71ee180e2a64874981f374c81472118391",
  ],
] as const)(
  "selects and checks the pinned %s cloudflared client without changing the server",
  (machine, architecture, checksum) => {
    const root = mkdtempSync(join(tmpdir(), "cloudflared-arch-"));
    try {
      writeFileSync(
        join(root, "uname"),
        `#!/bin/sh\nprintf '%s\\n' '${machine}'\n`,
        { mode: 0o700 },
      );
      writeFileSync(
        join(root, "curl"),
        '#!/bin/sh\nprintf "%s\\n" "$*" >> "$ARCH_FIXTURE/requests"\nwhile [ "$#" -gt 0 ]; do if [ "$1" = --output ]; then printf "#!/bin/sh\\necho fixture-version\\n" > "$2"; exit; fi; shift; done\nexit 90\n',
        { mode: 0o700 },
      );
      writeFileSync(
        join(root, "sha256sum"),
        '#!/bin/sh\ncat >> "$ARCH_FIXTURE/checksums"\nexit "${CHECKSUM_EXIT:-0}"\n',
        { mode: 0o700 },
      );
      const run = (status: number) =>
        spawnSync("sh", ["deploy/scripts/install-cloudflared-client.sh"], {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${root}:${process.env.PATH}`,
            RUNNER_TEMP: root,
            GITHUB_PATH: join(root, "path"),
            ARCH_FIXTURE: root,
            CHECKSUM_EXIT: String(status),
          },
        });
      // Failure is tested first so a prior executable cannot bypass verification.
      expect(run(1).status).toBe(65);
      const directory = join(root, `cloudflared-2026.8.3-${architecture}`);
      expect(existsSync(join(directory, "cloudflared"))).toBe(false);
      expect(existsSync(join(directory, "cloudflared.partial"))).toBe(false);
      expect(run(0).status).toBe(0);
      expect(readFileSync(join(root, "requests"), "utf8")).toContain(
        `/2026.8.3/cloudflared-linux-${architecture}`,
      );
      expect(readFileSync(join(root, "checksums"), "utf8")).toContain(
        `${checksum}  ${directory}/cloudflared.partial`,
      );
      expect(readFileSync(join(root, "path"), "utf8").trim()).toBe(directory);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
