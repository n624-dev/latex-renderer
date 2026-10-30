import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { githubCliEnvironment } from "../deploy/scripts/github-cli-environment.mjs";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
describe.skipIf(process.platform === "win32")(
  "GitHub CLI state outside immutable source",
  () => {
    it("isolates version, help and verification state even if HOME was absent and telemetry still writes", async () => {
      const root = await mkdtemp(join(tmpdir(), "gh-state-fixture-"));
      roots.push(root);
      const source = join(root, "source"),
        state = join(root, "state");
      await mkdir(source);
      await mkdir(state, { mode: 0o700 });
      await writeFile(join(source, "package.json"), "{}\n");
      const fake = join(root, "gh");
      await writeFile(
        fake,
        `#!${process.execPath}\nconst fs=require('node:fs'),p=require('node:path');const s=process.env.XDG_STATE_HOME??p.join(process.env.HOME??'.','.local/state');fs.mkdirSync(p.join(s,'gh'),{recursive:true});fs.writeFileSync(p.join(s,'gh/device-id'),require('node:crypto').randomUUID());console.log('gh version 2.98.0');\n`,
        { mode: 0o700 },
      );
      for (const args of [
        ["--version"],
        ["attestation", "verify", "--help"],
        ["attestation", "verify", "fixture.tar.gz"],
      ]) {
        const env = await githubCliEnvironment(state);
        expect(env.GH_TELEMETRY).toBe("disabled");
        execFileSync(fake, args, {
          cwd: source,
          env,
          encoding: "utf8",
          timeout: 5000,
        });
        expect(await readdir(source)).toEqual(["package.json"]);
      }
      expect(
        await readFile(join(state, "gh-state/gh/device-id"), "utf8"),
      ).toMatch(/^[a-f0-9-]{36}$/);
    });
    it("rejects symlink state roots and pre-existing unsafe state children", async () => {
      const root = await mkdtemp(join(tmpdir(), "gh-state-boundary-"));
      roots.push(root);
      const state = join(root, "state");
      await mkdir(state, { mode: 0o700 });
      await symlink(state, join(root, "link"));
      await expect(githubCliEnvironment(join(root, "link"))).rejects.toThrow(
        "private",
      );
      await symlink(join(root, "outside"), join(state, "gh-home"));
      await expect(githubCliEnvironment(state)).rejects.toThrow("unsafe");
    });
  },
);
