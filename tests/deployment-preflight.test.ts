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
  it.skipIf(process.platform !== "linux")(
    "installs smoke input explicitly under umask 077",
    () => {
      const root = mkdtempSync(join(tmpdir(), "renderer-smoke-input-"));
      try {
        const script = readFileSync(
          "deploy/scripts/smoke-test-production.sh",
          "utf8",
        );
        const start = script.indexOf('install -d -o "$smoke_user"');
        const end = script.indexOf("printf '%s' \"$token\"");
        expect(start).toBeGreaterThan(0);
        expect(end).toBeGreaterThan(start);
        const result = spawnSync(
          "sh",
          [
            "-c",
            `
        set -eu
        umask 077
        temporary_root=$1
        smoke_user=$(id -un)
        smoke_group=$(id -gn)
        ${script.slice(start, end)}
        stat -c '%a:%u' "$temporary_root/project/main.tex"
      `,
            "smoke-input-test",
            root,
          ],
          { encoding: "utf8" },
        );
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout.trim()).toBe(`400:${process.getuid?.()}`);
        expect(readFileSync(join(root, "project/main.tex"), "utf8")).toContain(
          "日本語",
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
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

  it.skipIf(process.platform === "win32")(
    "rejects maintenance before release mutation so the render smoke can run",
    () => {
      const root = mkdtempSync(join(tmpdir(), "renderer-maintenance-"));
      try {
        const source = readFileSync(
          "deploy/scripts/deploy-production-release.sh",
          "utf8",
        );
        const start = source.indexOf(
          "require_normal_maintenance_for_smoke() {",
        );
        const end = source.indexOf("\n}\n", start) + 2;
        expect(start).toBeGreaterThan(0);
        expect(end).toBeGreaterThan(start);
        expect(
          source.indexOf("require_normal_maintenance_for_smoke\n"),
        ).toBeLessThan(
          source.indexOf("deployment_checkpoint dependency-install"),
        );
        expect(
          source.indexOf("require_normal_maintenance_for_smoke\n", end),
        ).toBeLessThan(
          source.indexOf('"$source_root/deploy/scripts/prepare-host.sh"'),
        );

        const database = join(root, "renderer.sqlite3");
        const sqlite3 = join(root, "sqlite3");
        writeFileSync(database, "fixture");
        writeFileSync(sqlite3, '#!/bin/sh\nprintf "%s\\n" "$MOCK_MODE"\n', {
          mode: 0o700,
        });
        const functionBody = source
          .slice(start, end)
          .replace("/var/lib/latex-renderer/renderer.sqlite3", database);
        const run = (mode: string) =>
          spawnSync(
            "/bin/sh",
            ["-c", `${functionBody}\nrequire_normal_maintenance_for_smoke`],
            {
              encoding: "utf8",
              env: {
                ...process.env,
                PATH: `${root}:${process.env.PATH}`,
                MOCK_MODE: mode,
              },
            },
          );
        expect(run('"normal"').status).toBe(0);
        const readOnly = run('"read-only"');
        expect(readOnly.status).toBe(78);
        expect(readOnly.stderr).toContain("requires normal maintenance mode");
        expect(run("").status).toBe(78);
        rmSync(database);
        expect(run("").status).toBe(0); // No DB on a first install.
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
