import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readAuditCheckpoint,
  writeAuditCheckpoint,
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
      createdAt: "",
      id: "",
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
    const value = {
      createdAt: "2026-08-31T00:00:00.000Z",
      id: "audit_test",
    };
    await writeAuditCheckpoint(path, value);
    await expect(readAuditCheckpoint(path)).resolves.toEqual(value);
    expect((await stat(path)).mode & 0o777).toBe(0o640);
    const parsed = JSON.parse(await readFile(path, "utf8")) as Record<
      string,
      unknown
    >;
    parsed.id = "audit_tampered";
    await writeFile(path, `${JSON.stringify(parsed)}\n`, { mode: 0o600 });
    await expect(readAuditCheckpoint(path)).rejects.toThrow(
      "checkpoint checksum",
    );
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "audit-checkpoint-test-"));
  roots.push(root);
  return root;
}
