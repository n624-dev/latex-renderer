import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  rm,
  symlink,
  chmod,
  lstat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import {
  UpdaterSlots,
  updaterEnvelope,
  UPDATER_FILES,
} from "../deploy/scripts/updater-slots.mjs";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "updater-slots-"));
  roots.push(root);
  const source = join(root, "source"),
    slots = new UpdaterSlots(join(root, "updater"));
  await mkdir(join(source, "deploy/scripts"), { recursive: true });
  for (const path of UPDATER_FILES)
    await writeFile(join(source, path), `fixture: ${path}`);
  await writeFile(
    join(source, "deploy/updater-files.json"),
    JSON.stringify(UPDATER_FILES),
  );
  const stage = async (version: string) =>
    slots.stage(
      source,
      await updaterEnvelope(source, { version, commit: "a".repeat(40) }),
    );
  const first = await stage("9.0.0");
  await slots.nominate(first);
  return { root, source, slots, stage, first };
}
it("keeps the controller runnable after the application source is removed", async () => {
  const f = await fixture();
  await rm(f.source, { recursive: true });
  expect((await f.slots.verify(f.first)).envelope.version).toBe("9.0.0");
});
it("reuses identical updater bytes without another generation", async () => {
  const f = await fixture();
  expect(await f.stage("9.0.0")).toBe(f.first);
  expect(await readdir(join(f.slots.root, "slots"))).toEqual([f.first]);
});

it("keeps public code readable and recovery data private under a strict umask", async () => {
  const f = await fixture(),
    root = join(f.root, "strict");
  const id = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import {UpdaterSlots,updaterEnvelope} from './deploy/scripts/updater-slots.mjs';
    process.umask(0o077);
    const slots=new UpdaterSlots(process.argv[1]);
    const id=await slots.stage(process.argv[2],await updaterEnvelope(process.argv[2],{version:'9.0.0',commit:'a'.repeat(40)}));
    await slots.nominate(id);
    await slots.atomic(process.argv[1]+'/controller-state-backup.json','null',0o600);
    console.log(id);
  `,
      root,
      f.source,
    ],
    { encoding: "utf8" },
  ).trim();
  expect(
    (await lstat(join(root, "slots", id, "deploy/scripts/update-manager.mjs")))
      .mode & 0o777,
  ).toBe(0o644);
  expect((await lstat(join(root, "slots", id, "deploy"))).mode & 0o777).toBe(
    0o755,
  );
  expect(
    (await lstat(join(root, "controller-state-backup.json"))).mode & 0o777,
  ).toBe(0o600);
});
it("staging does not change the active controller; successful cutover retains recovery", async () => {
  const f = await fixture(),
    second = await f.stage("9.1.0");
  await f.slots.nominate(second);
  expect((await f.slots.state()).current).toBe(f.first);
  expect(await f.slots.begin()).toBe(true);
  expect((await f.slots.state()).pending?.from).toBe(f.first);
  await f.slots.finish();
  expect(await f.slots.state()).toMatchObject({
    current: second,
    previous: f.first,
    pending: null,
  });
});
it("recovers an interrupted cutover using durable state in a new process instance", async () => {
  const f = await fixture(),
    second = await f.stage("9.1.0");
  await f.slots.nominate(second);
  await f.slots.begin();
  const restarted = new UpdaterSlots(f.slots.root);
  expect(await restarted.recover()).toBe(true);
  expect((await restarted.state()).current).toBe(f.first);
  expect(await restarted.recover()).toBe(false);
});
it("retains only active/previous/candidate and collects interrupted staging", async () => {
  const f = await fixture();
  for (const version of ["9.1.0", "9.2.0", "9.3.0"]) {
    await f.slots.nominate(await f.stage(version));
    await f.slots.begin();
    await f.slots.finish();
  }
  const orphan = join(
    f.slots.root,
    "stage-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  );
  await mkdir(orphan);
  await writeFile(join(orphan, "partial"), "unfinished");
  await f.slots.collect();
  expect(await readdir(join(f.slots.root, "slots"))).toHaveLength(2);
  await expect(readFile(join(orphan, "partial"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
it("never collects a controller while activation is uncommitted", async () => {
  const f = await fixture();
  await f.slots.nominate(await f.stage("9.1.0"));
  await f.slots.begin();
  await expect(f.slots.collect()).rejects.toThrow("activation");
});
it("fails closed on corrupt state before stage, activation or cleanup", async () => {
  const f = await fixture();
  await writeFile(join(f.slots.root, "state.json"), "{");
  await expect(f.stage("9.1.0")).rejects.toThrow();
  await expect(f.slots.begin()).rejects.toThrow();
  await expect(f.slots.collect()).rejects.toThrow();
  expect((await f.slots.verify(f.first)).envelope.version).toBe("9.0.0");
});
it("rejects unknown bootstrap protocol and tampered payload", async () => {
  const f = await fixture();
  const envelope = await updaterEnvelope(f.source, {
    version: "9.1.0",
    commit: "a".repeat(40),
  });
  await expect(
    f.slots.stage(f.source, { ...envelope, schemaVersion: 2 }),
  ).rejects.toThrow("envelope");
  await writeFile(
    join(f.source, "deploy/scripts/update-manager.mjs"),
    "tampered",
  );
  await expect(f.slots.stage(f.source, envelope)).rejects.toThrow("checksum");
  expect((await f.slots.state()).current).toBe(f.first);
});
it("allows new internal modules without changing the bootstrap protocol", async () => {
  const f = await fixture();
  await writeFile(
    join(f.source, "deploy/scripts/new-updater-module.mjs"),
    "export const feature = true;",
  );
  await writeFile(
    join(f.source, "deploy/updater-files.json"),
    JSON.stringify([...UPDATER_FILES, "deploy/scripts/new-updater-module.mjs"]),
  );
  expect(
    (await f.slots.verify(await f.stage("9.1.0"))).envelope.files,
  ).toHaveProperty("deploy/scripts/new-updater-module.mjs");
});
it("rejects writable sources, traversal and outside symlinks without deletion", async () => {
  const f = await fixture();
  await chmod(join(f.source, "deploy/scripts/update-manager.mjs"), 0o666);
  await expect(f.stage("9.1.0")).rejects.toThrow("sealed");
  await expect(f.slots.verify("../../outside")).rejects.toThrow("ID");
  const outside = join(f.root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "keep"), "data");
  await symlink(outside, join(f.slots.root, "slots", "b".repeat(64)));
  await expect(f.slots.collect()).rejects.toThrow("Unsafe");
  expect(await readFile(join(outside, "keep"), "utf8")).toBe("data");
});
it("requires the release E2E before upload and grants it no publishing authority", async () => {
  const workflow = await readFile(
    ".github/workflows/server-release.yml",
    "utf8",
  );
  expect(workflow).toContain("needs: [build, update-e2e]");
  const e2e = workflow.split("  update-e2e:")[1]?.split("  upload-draft:")[0];
  expect(e2e).toContain("contents: read");
  expect(e2e).not.toContain("contents: write");
  expect(e2e).not.toContain("secrets.");
  expect(e2e).not.toContain("id-token: write");
  expect(workflow).not.toContain("actions/cache");
  const entry = await readFile(
    "deploy/scripts/update-manager-helper-launcher.sh",
    "utf8",
  );
  expect(entry).toContain("/updater/bootstrap-v1/updater-entry.mjs helper");
  expect(entry).not.toContain("/current/");
  const production = await readFile(
    "deploy/scripts/updater-bootstrap.mjs",
    "utf8",
  );
  expect(production).not.toContain("ci/");
  expect(production).toContain("downloadPublishedRelease");
});

it("packages the complete relative import closure of the runnable controllers", async () => {
  const envelope = await updaterEnvelope(process.cwd(), {
    version: "9.0.0",
    commit: "a".repeat(40),
  });
  for (const path of Object.keys(envelope.files)) {
    if (!path.endsWith(".mjs")) continue;
    const code = await readFile(path, "utf8");
    for (const match of code.matchAll(/from\s+["']\.\/([^"']+)["']/g)) {
      expect(
        envelope.files,
        `${path} imports missing ${match[1] ?? ""}`,
      ).toHaveProperty(`deploy/scripts/${match[1] ?? ""}`);
    }
    expect(() =>
      execFileSync(process.execPath, ["--check", path], { stdio: "pipe" }),
    ).not.toThrow();
  }
});

it("gives boot recovery and activation the shared lock's group/umask", async () => {
  for (const unit of ["recovery", "activate"]) {
    const text = await readFile(
      `deploy/systemd/latex-renderer-updater-${unit}.service`,
      "utf8",
    );
    expect(text).toContain("Group=latex-renderer");
    expect(text).toContain("UMask=0007");
  }
});
