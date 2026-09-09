import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { type UpdaterEnvelope } from "../deploy/scripts/updater-slots.mjs";
import { RENDERER_RUNTIME_FILES } from "../deploy/scripts/runtime-image-identity.mjs";

it("builds a deterministic fixture release containing a complete hashed Updater envelope (not a signed release)", async () => {
  const root = await mkdtemp(join(tmpdir(), "updater-release-fixture-"));
  const source = join(root, "source"),
    version = "9.0.0-rc.1",
    tag = `v${version}`;
  try {
    for (const dir of [
      "deploy/scripts",
      "deploy/systemd",
      "renderer",
      "client-dist",
    ])
      await mkdir(join(source, dir), { recursive: true });
    const currentFiles = JSON.parse(
      await readFile("deploy/updater-files.json", "utf8"),
    ) as string[];
    const files = new Set([
      ...currentFiles,
      "deploy/scripts/updater-slots.mjs",
      "deploy/scripts/build-server-release-assets.sh",
      "deploy/updater-files.json",
      "deploy/release-policy.json",
    ]);
    for (const path of files) await copyFile(path, join(source, path));
    await writeFile(
      join(source, "package.json"),
      JSON.stringify({
        version,
        packageManager: "pnpm@11.24.0",
        type: "module",
      }),
    );
    for (const path of RENDERER_RUNTIME_FILES)
      await writeFile(join(source, "renderer", path), `fixture: ${path}`);
    await writeFile(
      join(source, "deploy/systemd/latex-renderer-web.service"),
      "fixture service",
    );
    await symlink(
      "latex-renderer-web.service",
      join(source, "deploy/systemd/latex-renderer-admin-web.service"),
    );
    for (const name of [
      `latex-renderer-client-${version}.zip`,
      `latex-renderer-local-${version}.mcpb`,
    ])
      await writeFile(
        join(source, "client-dist", name),
        "fixture, not an executable client",
      );
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: source, stdio: "pipe" });
    git("init", "--quiet");
    git("add", ".");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.com",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    );
    git("tag", tag);
    for (const name of ["one", "two"])
      execFileSync(
        "sh",
        [
          join(source, "deploy/scripts/build-server-release-assets.sh"),
          tag,
          join(root, name),
        ],
        { stdio: "pipe" },
      );
    const name = `latex-renderer-server-${version}.tar.gz`,
      first = join(root, "one", name);
    expect(await readFile(first)).toEqual(
      await readFile(join(root, "two", name)),
    );
    const content = (path: string) =>
      execFileSync("tar", [
        "-xOzf",
        first,
        `latex-renderer-server-${version}/${path}`,
      ]);
    const envelope = JSON.parse(
      content(".latex-renderer-updater.json").toString(),
    ) as UpdaterEnvelope;
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      version,
      commit: git("rev-parse", "HEAD").toString().trim(),
    });
    expect(Object.keys(envelope.files)).toEqual(currentFiles);
    for (const [path, file] of Object.entries(envelope.files)) {
      const bytes = content(path);
      expect(bytes.length).toBe(file.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        file.sha256,
      );
    }
    // A new branch commit is testable without moving/creating any release tag.
    await writeFile(join(source, "branch-only.txt"), "new branch content");
    git("add", "branch-only.txt");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.com",
      "commit",
      "--quiet",
      "-m",
      "branch change",
    );
    expect(() =>
      execFileSync(
        "sh",
        [
          join(source, "deploy/scripts/build-server-release-assets.sh"),
          tag,
          join(root, "must-refuse"),
        ],
        { stdio: "pipe" },
      ),
    ).toThrow();
    execFileSync(
      "sh",
      [
        join(source, "deploy/scripts/build-server-release-assets.sh"),
        tag,
        join(root, "validation"),
        "",
        "--validation-only",
      ],
      { stdio: "pipe" },
    );
    const validationManifest: unknown = JSON.parse(
      execFileSync(
        "tar",
        [
          "-xOzf",
          join(root, "validation", name),
          `latex-renderer-server-${version}/.latex-renderer-release.json`,
        ],
        { encoding: "utf8" },
      ),
    );
    expect(
      (validationManifest as { validationOnly: boolean }).validationOnly,
    ).toBe(true);
    expect((validationManifest as { commit: string }).commit).toBe(
      git("rev-parse", "HEAD").toString().trim(),
    );
    expect(git("tag", "--points-at", "HEAD").toString().trim()).toBe("");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
