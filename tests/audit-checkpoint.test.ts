import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  readAuditCheckpoint,
  writeAuditCheckpoint,
  type AuditCheckpoint,
} from "../deploy/scripts/audit-checkpoint.mjs";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("audit export checkpoint", () => {
  it("treats only a missing checkpoint as the initial position", async () => {
    const root = await temporaryRoot(),
      path = join(root, "checkpoint");
    await expect(readAuditCheckpoint(path)).resolves.toEqual({
      format: 0,
    });
    await writeFile(path, "not-json", { mode: 0o600 });
    await expect(readAuditCheckpoint(path)).rejects.toThrow("checkpoint JSON");
    await chmod(path, 0o000);
    if (process.getuid?.() !== 0)
      await expect(readAuditCheckpoint(path)).rejects.toMatchObject({
        code: "EACCES",
      });
  });

  it("atomically writes and verifies a checksummed checkpoint", async () => {
    const root = await temporaryRoot(),
      path = join(root, "checkpoint");
    const value: AuditCheckpoint = {
      format: 3,
      databaseId: "a".repeat(64),
      sequence: "42",
      token: "b".repeat(64),
    };
    await writeAuditCheckpoint(path, value);
    await expect(readAuditCheckpoint(path)).resolves.toEqual(value);
    expect((await stat(path)).mode & 0o777).toBe(0o640);
    const parsed = JSON.parse(await readFile(path, "utf8")) as Record<
      string,
      unknown
    >;
    parsed.sequence = "41";
    await writeFile(path, `${JSON.stringify(parsed)}\n`, { mode: 0o600 });
    await expect(readAuditCheckpoint(path)).rejects.toThrow(
      "checkpoint checksum",
    );
  });

  it.each(["-1", "01", "1.5", "9223372036854775808"])(
    "rejects invalid sequence %s before writing",
    async (sequence) => {
      const path = join(await temporaryRoot(), "checkpoint");
      await expect(
        writeAuditCheckpoint(path, {
          format: 3,
          databaseId: "a".repeat(64),
          sequence,
          token: "b".repeat(64),
        }),
      ).rejects.toThrow("checkpoint schema");
      await expect(readAuditCheckpoint(path)).resolves.toEqual({ format: 0 });
    },
  );

  it("round-trips the full SQLite integer range without number truncation", async () => {
    const path = join(await temporaryRoot(), "checkpoint");
    const value: AuditCheckpoint = {
      format: 3,
      databaseId: "a".repeat(64),
      sequence: "9223372036854775807",
      token: "b".repeat(64),
    };
    await writeAuditCheckpoint(path, value);
    await expect(readAuditCheckpoint(path)).resolves.toEqual(value);
  });

  it("rejects unknown/downgraded checkpoint fields", async () => {
    const path = join(await temporaryRoot(), "checkpoint");
    await writeFile(
      path,
      JSON.stringify({ createdAt: "", id: "", sequence: "4" }),
    );
    await expect(readAuditCheckpoint(path)).rejects.toThrow(
      "checkpoint schema",
    );
    await writeFile(path, JSON.stringify({ format: 4, createdAt: "", id: "" }));
    await expect(readAuditCheckpoint(path)).rejects.toThrow(
      "checkpoint checksum",
    );
  });

  it("rejects FIFO and direct symlink checkpoints without waiting for a writer", async () => {
    const root = await temporaryRoot(),
      fifo = join(root, "fifo"),
      link = join(root, "link");
    await promisify(execFile)("mkfifo", [fifo]);
    await expect(readAuditCheckpoint(fifo)).rejects.toThrow("checkpoint file");
    await symlink(join(root, "absent-target"), link);
    await expect(readAuditCheckpoint(link)).rejects.toMatchObject({
      code: "ELOOP",
    });
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "audit-checkpoint-test-"));
  roots.push(root);
  return root;
}
