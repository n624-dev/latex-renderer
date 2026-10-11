import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { installedUpdaterEnvelope } from "../deploy/scripts/installed-updater-envelope.mjs";
import {
  UpdaterSlots,
  updaterEnvelope,
} from "../deploy/scripts/updater-slots.mjs";

const roots: string[] = [];
const manifest = { version: "7.8.9-rc.4", commit: "a".repeat(40) };
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "installed-updater-envelope-"));
  roots.push(root);
  const source = join(root, "source");
  await mkdir(join(source, "deploy/scripts"), { recursive: true });
  const files = JSON.parse(
    await readFile("deploy/updater-files.json", "utf8"),
  ) as string[];
  for (const directory of [
    source,
    join(source, "deploy"),
    join(source, "deploy/scripts"),
  ])
    await chmod(directory, 0o755);
  for (const file of [...files, "deploy/updater-files.json"]) {
    await copyFile(file, join(source, file));
    await chmod(join(source, file), 0o644);
  }
  const envelope = await updaterEnvelope(source, manifest);
  return { root, source, envelope };
}
it("selects and installs the complete modern controller on a staged first install", async () => {
  const { root, source, envelope } = await fixture();
  await writeFile(
    join(source, ".latex-renderer-updater.json"),
    JSON.stringify(envelope),
  );
  const selected = await installedUpdaterEnvelope(source, manifest);
  expect(selected).toEqual(envelope);
  const slots = new UpdaterSlots(
    join(root, "updater"),
    process.getuid?.() ?? 0,
  );
  const id = await slots.stage(source, selected);
  await slots.nominate(id);
  expect((await slots.state()).current).toBe(id);
  const installed = await slots.verify(id);
  expect(
    await readFile(join(installed.root, "deploy/scripts/github-json.mjs")),
  ).toEqual(await readFile(join(source, "deploy/scripts/github-json.mjs")));
});
it("retains legacy migration when the installed release has no envelope", async () => {
  const { source } = await fixture();
  expect(await installedUpdaterEnvelope(source, manifest)).toEqual(
    await updaterEnvelope(source, manifest, true),
  );
});
it.each(["malformed", "wrong-version", "wrong-commit"])(
  "refuses %s metadata rather than silently using the incomplete legacy controller",
  async (kind) => {
    const { source, envelope } = await fixture();
    const value =
      kind === "malformed"
        ? "{"
        : JSON.stringify({
            ...envelope,
            ...(kind === "wrong-version"
              ? { version: "7.8.9-rc.3" }
              : { commit: "b".repeat(40) }),
          });
    await writeFile(join(source, ".latex-renderer-updater.json"), value);
    await expect(installedUpdaterEnvelope(source, manifest)).rejects.toThrow();
  },
);
it("still verifies declared payload hashes before nomination", async () => {
  const { root, source, envelope } = await fixture();
  await writeFile(
    join(source, ".latex-renderer-updater.json"),
    JSON.stringify(envelope),
  );
  await writeFile(
    join(source, "deploy/scripts/github-json.mjs"),
    "tampered payload",
  );
  const selected = await installedUpdaterEnvelope(source, manifest);
  const slots = new UpdaterSlots(
    join(root, "updater"),
    process.getuid?.() ?? 0,
  );
  await expect(slots.stage(source, selected)).rejects.toThrow(
    "checksum mismatch",
  );
  await expect(slots.state()).rejects.toMatchObject({ code: "ENOENT" });
});
