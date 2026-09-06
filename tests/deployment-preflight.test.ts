import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("deployment prerequisite failure boundary", () => {
  it.skipIf(process.platform === "win32")(
    "runs the runtime identity CLI through a current symlink",
    () => {
      const root = mkdtempSync(join(tmpdir(), "renderer-cli-link-"));
      try {
        symlinkSync(process.cwd(), join(root, "current"), "dir");
        const result = spawnSync(
          process.execPath,
          [
            join(root, "current/deploy/scripts/runtime-image-identity.mjs"),
            "--renderer-fingerprint",
          ],
          { encoding: "utf8" },
        );
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout.trim()).toMatch(/^[a-f0-9]{64}$/);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
  it
    .skipIf(process.platform === "win32")
    .each(["deploy-production-release.sh", "prepare-host.sh"])(
    "%s rejects missing ACL tools before touching the host",
    (script) => {
      const bin = mkdtempSync(join(tmpdir(), "renderer-preflight-"));
      try {
        writeFileSync(join(bin, "id"), "#!/bin/sh\necho 0\n", { mode: 0o700 });
        symlinkSync("/usr/bin/dirname", join(bin, "dirname"));
        // No systemctl, rsync, useradd, or setfacl is available. Even when the
        // identity check says root, the script must stop at its early preflight.
        const result = spawnSync(
          "/bin/sh",
          [`deploy/scripts/${script}`, "test-release"],
          {
            env: { PATH: bin },
            encoding: "utf8",
          },
        );
        expect(result.status, result.stderr).toBe(69);
        expect(result.stderr).toContain("setfacl is required");
        expect(result.stderr).not.toContain("not found");
      } finally {
        rmSync(bin, { recursive: true, force: true });
      }
    },
  );
  it("does not activate the release until host preparation finishes", () => {
    const prepare = readFileSync("deploy/scripts/prepare-host.sh", "utf8");
    expect(prepare.indexOf('ln -sfn "$release_root"')).toBeGreaterThan(
      prepare.indexOf('while [ ! -S "$runtime_dir/docker.sock" ]'),
    );
    expect(prepare.match(/ln -sfn/g)).toHaveLength(1);
  });
});
