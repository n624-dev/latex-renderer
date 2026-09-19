import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { publishArtifactSet } from "../packages/client-core/src/artifact-transaction.js";

const roots: string[] = [],
  children: ChildProcess[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
  }
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "artifact-transaction-test-"));
  roots.push(root);
  const output = join(root, ".render");
  await mkdir(output, { mode: 0o700 });
  await writeFile(join(output, "result.pdf"), "old-pdf");
  await writeFile(join(output, "job.json"), "old-job");
  await writeFile(join(output, "notes.txt"), "user-notes");
  return { root, output, state: `${output}.latex-renderer-state` };
}
async function contents(output: string) {
  return Promise.all(
    ["result.pdf", "job.json", "notes.txt"].map((name) =>
      readFile(join(output, name), "utf8"),
    ),
  );
}
async function paused(output: string, phase: string) {
  const child = fork(
    resolve("tests/fixtures/artifact-transaction-child.mjs"),
    [output, phase],
    { execArgv: ["--import", "tsx"], silent: true },
  );
  children.push(child);
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const message = await new Promise<{ phase: string; message?: string }>(
    (resolveMessage, reject) => {
      child.once("message", (value) =>
        resolveMessage(value as { phase: string }),
      );
      child.once("exit", (code) =>
        reject(new Error(`Child exited ${String(code)}: ${stderr}`)),
      );
      child.once("error", reject);
    },
  );
  expect(message).toEqual({ phase });
  return child;
}
async function kill(child: ChildProcess) {
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
}

describe("whole artifact set publication", () => {
  it("keeps the old set visible during download and switches all files together", async () => {
    const { output, state } = await fixture();
    await publishArtifactSet(output, async (stage) => {
      await writeFile(join(stage, "result.pdf"), "new-pdf");
      expect(await contents(output)).toEqual([
        "old-pdf",
        "old-job",
        "user-notes",
      ]);
      await writeFile(join(stage, "job.json"), "new-job");
    });
    expect(await contents(output)).toEqual([
      "new-pdf",
      "new-job",
      "user-notes",
    ]);
    expect(await readdir(state)).toEqual([]);
  });
  it("leaves all prior files unchanged on a later download failure", async () => {
    const { output, state } = await fixture();
    await expect(
      publishArtifactSet(output, async (stage) => {
        await writeFile(join(stage, "result.pdf"), "partial-new-pdf");
        throw new Error("download failed");
      }),
    ).rejects.toThrow("download failed");
    expect(await contents(output)).toEqual([
      "old-pdf",
      "old-job",
      "user-notes",
    ]);
    expect(await readdir(state)).toEqual([]);
  });
  it("rejects concurrent writers including another call in the same process", async () => {
    const { output } = await fixture();
    await publishArtifactSet(output, async () => {
      await expect(
        publishArtifactSet(output, () =>
          Promise.reject(new Error("must not start")),
        ),
      ).rejects.toMatchObject({ code: "OUTPUT_BUSY" });
    });
  });
  it("does not evict a live independent writer", async () => {
    const { output } = await fixture(),
      child = await paused(output, "staging");
    await expect(
      publishArtifactSet(output, () =>
        Promise.reject(new Error("must not start")),
      ),
    ).rejects.toMatchObject({ code: "OUTPUT_BUSY" });
    expect(await contents(output)).toEqual([
      "old-pdf",
      "old-job",
      "user-notes",
    ]);
    await kill(child);
  });
  it.each(["staging", "backup", "published", "committed", "cleanup"])(
    "recovers after real process termination at %s",
    async (phase) => {
      const { output, state } = await fixture(),
        child = await paused(output, phase);
      await kill(child);
      await expect(
        publishArtifactSet(output, () =>
          Promise.reject(new Error("stop after recovery")),
        ),
      ).rejects.toThrow("stop after recovery");
      expect(await contents(output)).toEqual(
        ["committed", "cleanup"].includes(phase)
          ? ["new-pdf", "new-job", "user-notes"]
          : ["old-pdf", "old-job", "user-notes"],
      );
      expect(await readdir(state)).toEqual([]);
    },
  );
  it("preserves user edits made while downloading", async () => {
    const { output } = await fixture();
    await expect(
      publishArtifactSet(output, async (stage) => {
        await writeFile(join(stage, "result.pdf"), "new-pdf");
        await writeFile(join(output, "notes.txt"), "edited notes");
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_ARTIFACT_TRANSACTION" });
    expect(await contents(output)).toEqual([
      "old-pdf",
      "old-job",
      "edited notes",
    ]);
  });
  it("stops recovery if the journal is corrupt", async () => {
    const { output, state } = await fixture(),
      child = await paused(output, "staging");
    await kill(child);
    await writeFile(join(state, "transaction/journal.json"), "broken");
    await expect(
      publishArtifactSet(output, () => Promise.resolve()),
    ).rejects.toMatchObject({ code: "UNSAFE_ARTIFACT_TRANSACTION" });
    expect(await contents(output)).toEqual([
      "old-pdf",
      "old-job",
      "user-notes",
    ]);
  });
  it.each(["symlink", "hardlink"])(
    "does not follow a %s in output",
    async (kind) => {
      const { root, output } = await fixture(),
        outside = join(root, "outside.txt");
      await writeFile(outside, "outside");
      if (kind === "symlink")
        await symlink(outside, join(output, "linked.txt"));
      else await link(outside, join(output, "linked.txt"));
      await expect(
        publishArtifactSet(output, () => Promise.resolve()),
      ).rejects.toMatchObject({ code: "UNSAFE_OUTPUT_PATH" });
      expect(await readFile(outside, "utf8")).toBe("outside");
    },
  );
  it("does not recursively delete unrecognized control data or linked garbage", async () => {
    const { root, output, state } = await fixture();
    await mkdir(state, { mode: 0o700 });
    await writeFile(join(state, "user.txt"), "keep");
    await expect(
      publishArtifactSet(output, () => Promise.resolve()),
    ).rejects.toMatchObject({ code: "UNSAFE_ARTIFACT_TRANSACTION" });
    await rm(join(state, "user.txt"));
    await symlink(root, join(state, `gc-${randomUUID()}`), "junction");
    await expect(
      publishArtifactSet(output, () => Promise.resolve()),
    ).rejects.toMatchObject({ code: "UNSAFE_OUTPUT_PATH" });
    expect(await contents(output)).toEqual([
      "old-pdf",
      "old-job",
      "user-notes",
    ]);
  });
});
