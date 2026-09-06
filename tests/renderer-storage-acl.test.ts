import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("upgraded renderer storage ACL inheritance", () => {
  it("provisions ACL tools in every workflow running the full suite", () => {
    for (const workflow of [
      "ci.yml",
      "server-release.yml",
      "renderer-image-daily.yml",
    ]) {
      const source = readFileSync(`.github/workflows/${workflow}`, "utf8");
      const prerequisites = source.indexOf(
        "sudo apt-get install --no-install-recommends --yes age acl",
      );
      expect(prerequisites, workflow).toBeGreaterThan(0);
      expect(prerequisites, workflow).toBeLessThan(
        source.indexOf("pnpm check"),
      );
    }
  });
  it.skipIf(process.platform !== "linux")(
    "repairs existing parents and grants mapped access to future jobs without public access",
    () => {
      const root = mkdtempSync(join(tmpdir(), "renderer-storage-acl-"));
      try {
        const jobs = join(root, "jobs");
        mkdirSync(join(jobs, "old-job/attempts"), {
          recursive: true,
          mode: 0o770,
        });
        writeFileSync(join(jobs, "old-job/existing.log"), "fixture", {
          mode: 0o660,
        });
        const script = readFileSync(
          "deploy/scripts/configure-renderer-storage-acl.sh",
          "utf8",
        );
        const start = script.indexOf('setfacl -m "u:${mapped_uid}');
        expect(start).toBeGreaterThan(0);
        const result = spawnSync(
          "sh",
          [
            "-c",
            `
        set -eu
        storage_root=$1
        mapped_uid=175535
        mapped_gid=175535
        cleanup_gid=$(id -g)
        ${script.slice(start)}
        mkdir -p "$storage_root/jobs/new-job/attempts/1/staging"
        touch "$storage_root/jobs/new-job/attempts/1/staging/output.log"
      `,
            "storage-acl-test",
            root,
          ],
          { encoding: "utf8" },
        );
        expect(result.status, result.stderr).toBe(0);
        for (const path of [
          root,
          jobs,
          join(jobs, "old-job/attempts"),
          join(jobs, "new-job/attempts/1/staging"),
        ]) {
          const acl = spawnSync("getfacl", ["-cpn", path], {
            encoding: "utf8",
          });
          expect(acl.status, acl.stderr).toBe(0);
          expect(acl.stdout).toContain("default:user:175535:rwx");
          expect(acl.stdout).toContain("default:other::---");
          expect(acl.stdout).toContain("other::---");
        }
        for (const path of [
          join(jobs, "old-job/existing.log"),
          join(jobs, "new-job/attempts/1/staging/output.log"),
        ]) {
          const acl = spawnSync("getfacl", ["-cpn", path], {
            encoding: "utf8",
          });
          expect(acl.status, acl.stderr).toBe(0);
          expect(acl.stdout).toMatch(/user:175535:rw/);
          expect(acl.stdout).toContain("other::---");
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
