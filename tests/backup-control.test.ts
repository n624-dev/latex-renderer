import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleBackupRequest } from "../deploy/scripts/backup-control.mjs";
import type { BackupRetentionRun } from "../deploy/scripts/backup-retention.mjs";

const newest = "latex-renderer-2026-11-28T00-00-00.000Z.tar.age";
const recent = "latex-renderer-2026-11-27T00-00-00.000Z.tar.age";
const verified = "latex-renderer-2026-11-26T00-00-00.000Z.tar.age";
const now = new Date("2026-11-28T00:00:00.000Z");
const limits = { maxAgeDays: 30, maxGenerations: 10, maxTotalBytes: 1000 };
const proposed = { maxAgeDays: 1, maxGenerations: 1, maxTotalBytes: 0 };
const receipt = { archive: verified, verifiedAt: now.toISOString() };
const confirmed = {
  ...limits,
  confirmedAt: now.toISOString(),
  confirmedBy: "key_owner",
};

describe.skipIf(process.platform !== "linux")(
  "backup control retention requests",
  () => {
    let root: string;
    let directory: string;
    let receiptPath: string;
    let databasePath: string;
    let database: DatabaseSync;

    beforeEach(async () => {
      root = await fs.mkdtemp(join(tmpdir(), "backup-control-"));
      directory = join(root, "archives");
      await fs.mkdir(directory);
      receiptPath = join(root, "latest.json");
      databasePath = join(root, "live.sqlite3");
      database = new DatabaseSync(databasePath);
      database.exec(
        "CREATE TABLE system_settings (key TEXT PRIMARY KEY, value_json TEXT)",
      );
    });

    afterEach(async () => {
      database.close();
      await fs.rm(root, { recursive: true, force: true });
    });

    const writeState = async (path: string, run: BackupRetentionRun) => {
      await fs.writeFile(path, JSON.stringify(run), { mode: 0o640 });
    };
    const statfs = vi.fn(() => Promise.resolve({ bavail: 45n, bsize: 10n }));
    const request = async (
      message: string,
      overrides: { fs?: typeof fs } = {},
    ) =>
      handleBackupRequest(message, {
        databasePath,
        directory,
        receiptPath,
        now,
        statfs,
        log: vi.fn(),
        writeState,
        fs: {
          ...fs,
          // The production state files are root-owned. The test runs without root.
          lstat: (async (...args: Parameters<typeof fs.lstat>) => {
            const info = await fs.lstat(...args);
            return Object.assign(info, { uid: 0 });
          }) as typeof fs.lstat,
        },
        ...overrides,
      });

    async function writeArchives() {
      for (const archive of [newest, recent, verified])
        await fs.writeFile(join(directory, archive), Buffer.alloc(20));
      await fs.writeFile(join(directory, "partial"), "ignored");
      await fs.writeFile(receiptPath, JSON.stringify(receipt), { mode: 0o640 });
    }

    function setPolicy(policy: unknown) {
      database
        .prepare("INSERT OR REPLACE INTO system_settings VALUES (?, ?)")
        .run("backup_retention_policy", JSON.stringify(policy));
    }

    it("returns live status and previews exact protected warnings without deleting", async () => {
      await writeArchives();
      setPolicy(confirmed);
      await expect(request("retention\n")).resolves.toMatchObject({
        archives: [newest, recent, verified].map((name) => ({
          name,
          bytes: 20,
        })),
        freeBytes: 450,
        latestVerification: receipt,
        schedule: "daily",
        policy: confirmed,
        lastRun: null,
        proposedPlan: null,
        plan: { configured: true, delete: [] },
      });
      const options = { minFreeStorageBytes: 110, proposedPolicy: proposed };
      await expect(
        request(`retention ${JSON.stringify(options)}\n`),
      ).resolves.toMatchObject({
        candidates: { maxAgeDays: 5, maxGenerations: 5, maxTotalBytes: 100 },
        plan: { delete: [] },
        proposedPlan: {
          delete: [recent],
          protected: [newest, verified],
          warnings: [
            "PROTECTED_OVER_BYTES",
            "PROTECTED_OVER_GENERATIONS",
            "PROTECTED_OVER_AGE",
          ],
        },
      });
      expect(statfs).toHaveBeenCalledWith(directory, { bigint: true });
      expect((await fs.readdir(directory)).sort()).toEqual([
        verified,
        recent,
        newest,
        "partial",
      ]);
    });

    it("offers no candidates before the first backup", async () => {
      await expect(request("retention\n")).resolves.toMatchObject({
        archives: [],
        policy: null,
        candidates: null,
        latestVerification: null,
        lastRun: null,
      });
    });

    it.each([
      "retention {}",
      "retention [1]\n",
      "retention {\n",
      'retention {"proposedPolicy":null}\n',
      'retention {"proposedPolicy":{"maxAgeDays":1}}\n',
      `retention ${JSON.stringify({ proposedPolicy: { ...proposed, maxAgeDays: 0 } })}\n`,
      `retention ${JSON.stringify({ proposedPolicy: { ...proposed, maxGenerations: "1" } })}\n`,
      `retention ${JSON.stringify({ proposedPolicy: { ...proposed, maxTotalBytes: -1 } })}\n`,
      `retention ${JSON.stringify({ proposedPolicy: { ...proposed, confirmedBy: "owner" } })}\n`,
      'retention {"minFreeStorageBytes":-1}\n',
      'retention {"directory":"/"}\n',
      "retention\nprune\n",
      "prune {}\n",
      `retention ${" ".repeat(512)}{}\n`,
    ])("rejects invalid request %s", async (message) => {
      await expect(request(message)).rejects.toThrow();
    });

    it("prunes with the live policy and publishes the actual result as lastRun", async () => {
      await writeArchives();
      setPolicy({ ...confirmed, ...proposed });
      const run = {
        status: "succeeded",
        at: now.toISOString(),
        deleted: [recent],
        warnings: [
          "PROTECTED_OVER_BYTES",
          "PROTECTED_OVER_GENERATIONS",
          "PROTECTED_OVER_AGE",
        ],
      };
      await expect(request("prune\n")).resolves.toMatchObject(run);
      expect((await fs.readdir(directory)).sort()).toEqual([
        verified,
        newest,
        "partial",
      ]);
      await expect(request("retention\n")).resolves.toMatchObject({
        lastRun: run,
      });
      await expect(request("prune\n")).resolves.toMatchObject({ deleted: [] });
    });

    it("keeps all archives when limits have no confirmation", async () => {
      await writeArchives();
      setPolicy(proposed);
      await expect(request("prune\n")).resolves.toMatchObject({
        configured: false,
        deleted: [],
        warnings: ["POLICY_INVALID"],
      });
    });

    it("records completed deletions even when a later unlink fails", async () => {
      await writeArchives();
      await fs.rm(receiptPath);
      setPolicy({ ...confirmed, ...proposed });
      const unlink = vi
        .fn(fs.unlink)
        .mockImplementationOnce(fs.unlink)
        .mockRejectedValueOnce(new Error("permission denied"));
      const run = {
        status: "failed",
        at: now.toISOString(),
        deleted: [recent],
        warnings: ["PROTECTED_OVER_BYTES", "PRUNE_FAILED"],
      };
      await expect(
        request("prune\n", { fs: { ...fs, unlink } }),
      ).resolves.toMatchObject(run);
      await expect(request("retention\n")).resolves.toMatchObject({
        lastRun: run,
      });
    });
  },
);
