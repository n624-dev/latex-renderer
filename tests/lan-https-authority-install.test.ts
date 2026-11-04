import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  chmodSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { installLanHttpsAuthorityRelease } from "../deploy/lan-https/install-authority.mjs";
const roots: string[] = [];
afterEach(() => {
  for (const path of roots.splice(0))
    rmSync(path, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "lan-authority-install-"));
  roots.push(root);
  const source = join(root, "source"),
    target = join(root, "installed");
  for (const dir of [
    "deploy/lan-https/bin",
    "deploy/scripts",
    "packages/server-setup-core/src",
  ])
    mkdirSync(join(source, dir), { recursive: true, mode: 0o755 });
  const seal = (path: string) => {
    chmodSync(path, 0o755);
    for (const name of readdirSync(path, { withFileTypes: true }))
      if (name.isDirectory()) seal(join(path, name.name));
  };
  seal(source);
  writeFileSync(
    join(source, "deploy/lan-https/cli.mjs"),
    "export const fixture=true;\n",
    { mode: 0o644 },
  );
  writeFileSync(
    join(source, "deploy/scripts/is-main-module.mjs"),
    "export const fixture=true;\n",
    { mode: 0o644 },
  );
  writeFileSync(
    join(source, "packages/server-setup-core/src/lan-https.mjs"),
    "export const fixture=true;\n",
    { mode: 0o644 },
  );
  const architecture = process.arch === "x64" ? "amd64" : "arm64",
    binary = Buffer.alloc(20);
  binary.write("\x7fELF");
  binary[4] = 2;
  binary[5] = 1;
  binary.writeUInt16LE(architecture === "amd64" ? 62 : 183, 18);
  const path = `bin/lan-https-linux-${architecture}`;
  writeFileSync(join(source, "deploy/lan-https", path), binary, {
    mode: 0o750,
  });
  const select = (commit: string) => {
    writeFileSync(
      join(source, ".latex-renderer-release.json"),
      JSON.stringify({
        schemaVersion: 1,
        repository: "n624-dev/latex-renderer",
        provenance: "github-artifact-attestation",
        version: "1.6.0-rc.1",
        commit,
      }),
      { mode: 0o644 },
    );
    writeFileSync(
      join(source, "deploy/lan-https/binaries.json"),
      JSON.stringify({
        format: 1,
        version: "1.6.0-rc.1",
        commit,
        binaries: {
          [architecture]: {
            path,
            bytes: binary.length,
            sha256: createHash("sha256").update(binary).digest("hex"),
          },
        },
      }),
      { mode: 0o644 },
    );
  };
  select("a".repeat(40));
  const install = () =>
    installLanHttpsAuthorityRelease(source, {
      rootDirectory: target,
      uid: process.geteuid?.() ?? 0,
    });
  return { source, target, select, install };
}
it("installs isolated public code, reuses identical releases and retains only current/previous", async () => {
  const f = fixture();
  expect((await f.install()).reused).toBe(false);
  expect((await f.install()).reused).toBe(true);
  for (const id of ["b", "c", "d"]) {
    f.select(id.repeat(40));
    await f.install();
  }
  expect(readdirSync(join(f.target, "releases")).sort()).toEqual([
    "c".repeat(40),
    "d".repeat(40),
  ]);
  expect(readlinkSync(join(f.target, "current"))).toBe(
    "releases/" + "d".repeat(40),
  );
  expect(
    readFileSync(join(f.target, "current/deploy/lan-https/cli.mjs"), "utf8"),
  ).toContain("fixture");
});
it("recovers interrupted staging but refuses corrupt selection and external links without deleting data", async () => {
  const f = fixture();
  await f.install();
  mkdirSync(join(f.target, ".staging"), { mode: 0o755 });
  writeFileSync(join(f.target, ".staging/partial"), "incomplete", {
    mode: 0o644,
  });
  await f.install();
  expect(readdirSync(f.target)).not.toContain(".staging");
  const pointer = readlinkSync(join(f.target, "current"));
  writeFileSync(join(f.target, ".management/profiles.json"), "broken", {
    mode: 0o600,
  });
  await expect(f.install()).rejects.toThrow();
  expect(readlinkSync(join(f.target, "current"))).toBe(pointer);
});
it("refuses an external symlink in a retiring code slot", async () => {
  const f = fixture();
  await f.install();
  f.select("b".repeat(40));
  await f.install();
  const outside = join(f.source, "untouched");
  writeFileSync(outside, "retained", { mode: 0o644 });
  symlinkSync(outside, join(f.target, "releases", "a".repeat(40), "external"));
  f.select("c".repeat(40));
  await expect(f.install()).rejects.toThrow(/Unsafe/);
  expect(readFileSync(outside, "utf8")).toBe("retained");
  expect(readlinkSync(join(f.target, "current"))).toBe(
    "releases/" + "b".repeat(40),
  );
});
