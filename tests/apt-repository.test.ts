import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

const available = ["apt-ftparchive", "dpkg-deb", "gpg", "gpgv"].every(
  (command) => spawnSync(command, ["--version"]).status === 0,
);

it.runIf(available)(
  "signs an architecture-specific APT index with immutable index hashes",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "n624-apt-test-"));
    const keyHome = join(root, "gnupg");
    const packages = join(root, "packages");
    const site = join(root, "site");
    await mkdir(keyHome, { mode: 0o700 });
    await mkdir(packages);
    const env: NodeJS.ProcessEnv = { ...process.env, GNUPGHOME: keyHome };
    const invoke = (command: string, args: string[], options = env) =>
      spawnSync(command, args, { env: options, encoding: "utf8" });
    const run = (command: string, args: string[]) => {
      const result = invoke(command, args);
      expect(result.status, result.stderr).toBe(0);
      return result.stdout;
    };
    try {
      run("gpg", [
        "--batch",
        "--passphrase",
        "",
        "--quick-generate-key",
        "Disposable repository test",
        "ed25519",
        "sign",
        "1d",
      ]);
      const fingerprint = run("gpg", ["--with-colons", "--fingerprint"])
        .split("\n")
        .find((line) => line.startsWith("fpr:"))
        ?.split(":")[9];
      expect(fingerprint).toMatch(/^[A-F0-9]{40}$/);
      for (const arch of ["amd64", "arm64"]) {
        const packageRoot = join(root, arch);
        await mkdir(join(packageRoot, "DEBIAN"), { recursive: true });
        await writeFile(
          join(packageRoot, "DEBIAN/control"),
          [
            "Package: n624-latex",
            "Version: 1.0.0",
            `Architecture: ${arch}`,
            "Maintainer: APT test <apt-test@example.invalid>",
            "Description: Test package",
            "",
          ].join("\n"),
        );
        run("dpkg-deb", [
          "--root-owner-group",
          "--build",
          packageRoot,
          join(packages, `n624-latex_1.0.0_${arch}.deb`),
        ]);
      }
      const builder = resolve("deploy/apt/build-repository.mjs");
      const result = invoke(
        process.execPath,
        [builder, packages, site, "https://example.invalid/project"],
        {
          ...env,
          N624_APT_FINGERPRINT: fingerprint,
        },
      );
      expect(result.status, result.stderr).toBe(0);
      const suite = join(site, "dists/stable");
      const keyring = join(keyHome, "trusted.gpg");
      run("gpg", ["--batch", "--output", keyring, "--export"]);
      run("gpgv", ["--keyring", keyring, join(suite, "InRelease")]);
      const sources = await readFile(join(site, "n624-latex.sources"), "utf8");
      expect(sources).toContain("URIs: https://example.invalid/project\n");
      expect(sources).toContain(
        "Signed-By:\n -----BEGIN PGP PUBLIC KEY BLOCK-----",
      );
      for (const arch of ["amd64", "arm64"]) {
        const index = join(suite, "main", `binary-${arch}`);
        const content = await readFile(join(index, "Packages"));
        expect(content.toString().match(/^Architecture: .+$/gm)).toEqual([
          `Architecture: ${arch}`,
        ]);
        for (const algorithm of ["SHA256", "SHA512"]) {
          const hash = createHash(algorithm.toLowerCase())
            .update(content)
            .digest("hex");
          expect(
            await readFile(join(index, "by-hash", algorithm, hash)),
          ).toEqual(content);
        }
      }
      await rm(join(packages, "n624-latex_1.0.0_arm64.deb"));
      const incomplete = invoke(
        process.execPath,
        [
          builder,
          packages,
          join(root, "incomplete"),
          "https://example.invalid/project",
        ],
        { ...env, N624_APT_FINGERPRINT: fingerprint },
      );
      expect(incomplete.status).not.toBe(0);
      expect(incomplete.stderr).toContain(
        "Every release must include both architectures",
      );
      const candidate = "n624-latex_1.0.0~rc.1_amd64.deb";
      await rename(
        join(packages, "n624-latex_1.0.0_amd64.deb"),
        join(packages, candidate),
      );
      const prerelease = invoke(
        process.execPath,
        [
          builder,
          packages,
          join(root, "prerelease"),
          "https://example.invalid/project",
        ],
        { ...env, N624_APT_FINGERPRINT: fingerprint },
      );
      expect(prerelease.status).not.toBe(0);
      expect(prerelease.stderr).toContain(
        `Unexpected APT package: ${candidate}`,
      );
    } finally {
      invoke("gpgconf", ["--kill", "gpg-agent"]);
      await rm(root, { recursive: true, force: true });
    }
  },
);
