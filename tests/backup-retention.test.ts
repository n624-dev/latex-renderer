import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BackupRetentionOptions,
  applyBackupRetention,
  archivePattern,
  backupRetentionCandidates,
  backupRetentionSettingKey,
  planBackupRetention,
  readBackupRetentionPolicy,
  readVerificationReceipt,
  runPostBackupRetention,
} from "../deploy/scripts/backup-retention.mjs";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    lstat: vi.fn(actual.lstat),
    unlink: vi.fn(actual.unlink),
  };
});

function archive(stamp: string, bytes = 10) {
  return { name: `latex-renderer-${stamp}.tar.age`, bytes };
}

const now = new Date("2026-11-28T00:00:00.000Z");
const policy = { maxAgeDays: 30, maxGenerations: 10, maxTotalBytes: 100 };
const newest = archive("2026-11-28T00-00-00.000Z");
const recent = archive("2026-11-27T00-00-00.000Z");
const atAgeLimit = archive("2026-11-26T00-00-00.000Z");
const older = archive("2026-11-25T23-59-59.999Z");

function plan(
  archives: BackupRetentionOptions["archives"],
  overrides: Partial<Omit<BackupRetentionOptions, "archives">> = {},
) {
  return planBackupRetention({ archives, policy, now, ...overrides });
}

describe("encrypted backup retention", () => {
  it("keeps every backup when the policy is unconfirmed", () => {
    const archives = [older, newest, recent];
    expect(
      plan(archives, { policy: null, latestVerifiedArchive: older.name }),
    ).toEqual({
      configured: false,
      keep: [newest.name, recent.name, older.name],
      delete: [],
      protected: [newest.name, older.name],
      keptBytes: 30,
      deletedBytes: 0,
      warnings: [],
    });
    expect(archives).toEqual([older, newest, recent]);
  });

  it.each([
    { limit: "age", limits: { maxAgeDays: 2 } },
    { limit: "generations", limits: { maxGenerations: 2 } },
    { limit: "bytes", limits: { maxTotalBytes: 20 } },
  ])("enforces the $limit limit on its own", ({ limits }) => {
    expect(
      plan([older, newest, atAgeLimit], { policy: { ...policy, ...limits } }),
    ).toEqual({
      configured: true,
      keep: [newest.name, atAgeLimit.name],
      delete: [older.name],
      protected: [newest.name],
      keptBytes: 20,
      deletedBytes: 10,
      warnings: [],
    });
  });

  it("rejects an archive that meets the age and generation limits but exceeds the byte limit", () => {
    expect(
      plan([older, recent, atAgeLimit, newest], {
        policy: { maxAgeDays: 2, maxGenerations: 3, maxTotalBytes: 25 },
      }),
    ).toMatchObject({
      keep: [newest.name, recent.name],
      delete: [atAgeLimit.name, older.name],
      keptBytes: 20,
      deletedBytes: 20,
      warnings: [],
    });
  });

  it("deletes an older archive that would fit after a newer archive is rejected", () => {
    const small = { ...older, bytes: 1 };
    expect(
      plan([small, recent, newest], {
        policy: { ...policy, maxTotalBytes: 11 },
      }),
    ).toMatchObject({
      keep: [newest.name],
      delete: [recent.name, small.name],
      keptBytes: 10,
      deletedBytes: 11,
    });
  });

  it("keeps a verified archive older than the age cutoff", () => {
    expect(
      plan([older, atAgeLimit, newest, recent], {
        policy: { ...policy, maxAgeDays: 1 },
        latestVerifiedArchive: older.name,
      }),
    ).toMatchObject({
      keep: [newest.name, recent.name, older.name],
      delete: [atAgeLimit.name],
      protected: [newest.name, older.name],
      keptBytes: 30,
      deletedBytes: 10,
      warnings: ["PROTECTED_OVER_AGE"],
    });
  });

  it.each([
    { limit: "bytes", limits: { maxTotalBytes: 20 } },
    { limit: "generations", limits: { maxGenerations: 2 } },
  ])(
    "reserves $limit for the verified archive before considering newer candidates",
    ({ limits }) => {
      expect(
        plan([recent, older, newest], {
          policy: { ...policy, ...limits },
          latestVerifiedArchive: older.name,
        }),
      ).toMatchObject({
        keep: [newest.name, older.name],
        delete: [recent.name],
        keptBytes: 20,
        warnings: [],
      });
    },
  );

  it("counts the newest archive once when it is also the verified archive", () => {
    expect(
      plan([recent, newest], {
        policy: { ...policy, maxGenerations: 2, maxTotalBytes: 20 },
        latestVerifiedArchive: newest.name,
      }),
    ).toMatchObject({
      keep: [newest.name, recent.name],
      delete: [],
      protected: [newest.name],
      keptBytes: 20,
      warnings: [],
    });
  });

  it("warns when the protected archives alone exceed the byte and generation limits", () => {
    expect(
      plan([recent, older, newest], {
        policy: { ...policy, maxGenerations: 1, maxTotalBytes: 19 },
        latestVerifiedArchive: older.name,
      }),
    ).toMatchObject({
      keep: [newest.name, older.name],
      delete: [recent.name],
      protected: [newest.name, older.name],
      keptBytes: 20,
      deletedBytes: 10,
      warnings: ["PROTECTED_OVER_BYTES", "PROTECTED_OVER_GENERATIONS"],
    });
  });

  it("ignores non-backup names even if a restore receipt names one", () => {
    const partial = { name: `${newest.name}.partial`, bytes: 100 };
    const unrelated = { name: "README", bytes: -1 };
    expect(archivePattern.test(newest.name)).toBe(true);
    expect(archivePattern.test(partial.name)).toBe(false);
    expect(
      plan([partial, recent, unrelated, newest], {
        policy: { ...policy, maxGenerations: 2, maxTotalBytes: 20 },
        latestVerifiedArchive: partial.name,
      }),
    ).toEqual({
      configured: true,
      keep: [newest.name, recent.name],
      delete: [],
      protected: [newest.name],
      keptBytes: 20,
      deletedBytes: 0,
      warnings: [],
    });
  });

  it("treats a future archive as age zero", () => {
    const future = archive("2026-12-01T01-23-45.678Z");
    const latest = archive("2026-12-02T08-09-10.111Z");
    expect(
      plan([future, latest, older], { policy: { ...policy, maxAgeDays: 1 } }),
    ).toMatchObject({
      keep: [latest.name, future.name],
      delete: [older.name],
      protected: [latest.name],
      warnings: [],
    });
  });

  it.each(["maxAgeDays", "maxGenerations", "maxTotalBytes"])(
    "rejects invalid %s",
    (limit) => {
      for (const value of [undefined, -1, 1.5, 2 ** 53, "1"]) {
        expect(() =>
          plan([], { policy: { ...policy, [limit]: value } }),
        ).toThrow(limit);
      }
    },
  );

  it.each([-1, 0.5, 2 ** 53, Infinity, NaN])(
    "rejects invalid backup bytes (%s)",
    (bytes) => {
      expect(() => plan([{ ...newest, bytes }])).toThrow(
        "Invalid archive bytes",
      );
    },
  );

  it.each(["2026-13-01T00-00-00.000Z", "2026-02-29T00-00-00.000Z"])(
    "rejects invalid backup timestamps (%s)",
    (stamp) => {
      expect(() => plan([archive(stamp)], { policy: null })).toThrow(
        "Invalid archive timestamp",
      );
    },
  );

  it("rejects an invalid planning time", () => {
    expect(() => plan([newest], { now: new Date(NaN) })).toThrow(
      "Invalid now timestamp",
    );
  });

  it("counts repeated entries for the same archive once and rejects conflicting sizes", () => {
    expect(plan([recent, recent, newest])).toMatchObject({
      keep: [newest.name, recent.name],
      delete: [],
      keptBytes: 20,
    });
    expect(() => plan([recent, { ...recent, bytes: 11 }])).toThrow(
      "Conflicting archive bytes",
    );
  });
});

describe("backup retention candidates", () => {
  it("requires a completed backup", () => {
    expect(
      backupRetentionCandidates({
        archives: [],
        freeBytes: 1_000,
        minFreeStorageBytes: 10,
      }),
    ).toBeNull();
  });

  it.each([
    { freeBytes: 14, reserve: 1, budget: 7, generations: 1 },
    { freeBytes: 500, reserve: 8, budget: 127, generations: 12 },
    { freeBytes: 2_000, reserve: 0, budget: 504, generations: 30 },
    { freeBytes: 14, reserve: 50, budget: 0, generations: 1 },
  ])(
    "offers $generations days and generations for a budget of $budget bytes",
    ({ freeBytes, reserve, budget, generations }) => {
      expect(
        backupRetentionCandidates({
          archives: [newest, { ...older, bytes: 6 }],
          freeBytes,
          minFreeStorageBytes: reserve,
        }),
      ).toEqual({
        maxAgeDays: generations,
        maxGenerations: generations,
        maxTotalBytes: budget,
      });
    },
  );

  it("applies a zero byte limit while protecting the newest backup", () => {
    expect(
      plan([older, newest], { policy: { ...policy, maxTotalBytes: 0 } }),
    ).toMatchObject({
      keep: [newest.name],
      delete: [older.name],
      warnings: ["PROTECTED_OVER_BYTES"],
    });
  });
});

describe("readBackupRetentionPolicy", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
  });
  afterEach(() => db.close());

  function createSettings() {
    db.exec("CREATE TABLE system_settings (key TEXT PRIMARY KEY, value_json)");
    return db.prepare("INSERT INTO system_settings VALUES (?, ?)");
  }

  it("returns no policy when the settings table is missing", () => {
    expect(readBackupRetentionPolicy(db)).toEqual({
      policy: null,
      warning: null,
    });
  });

  it("returns no policy when the setting is missing", () => {
    createSettings().run("other_setting", JSON.stringify(policy));
    expect(readBackupRetentionPolicy(db)).toEqual({
      policy: null,
      warning: null,
    });
  });

  it("reads the confirmed limits and confirmation metadata", () => {
    expect(backupRetentionSettingKey).toBe("backup_retention_policy");
    createSettings().run(
      backupRetentionSettingKey,
      JSON.stringify({
        ...policy,
        confirmedAt: now.toISOString(),
        confirmedBy: "admin",
      }),
    );
    expect(readBackupRetentionPolicy(db)).toEqual({
      policy: {
        ...policy,
        confirmedAt: now.toISOString(),
        confirmedBy: "admin",
      },
      warning: null,
    });
  });

  it.each([
    { description: "invalid JSON", value: "{" },
    { description: "JSON null", value: "null" },
    { description: "JSON array", value: "[]" },
    { description: "missing limits", value: "{}" },
    { description: "missing confirmation", value: JSON.stringify(policy) },
    {
      description: "zero days",
      value: JSON.stringify({
        ...policy,
        maxAgeDays: 0,
        confirmedAt: now.toISOString(),
        confirmedBy: "owner",
      }),
    },
    {
      description: "fractional generations",
      value: JSON.stringify({
        ...policy,
        maxGenerations: 1.5,
        confirmedAt: now.toISOString(),
        confirmedBy: "owner",
      }),
    },
    {
      description: "unsafe byte count",
      value: JSON.stringify({
        ...policy,
        maxTotalBytes: 2 ** 53,
        confirmedAt: now.toISOString(),
        confirmedBy: "owner",
      }),
    },
    {
      description: "numeric string",
      value: JSON.stringify({
        ...policy,
        maxTotalBytes: "100",
        confirmedAt: now.toISOString(),
        confirmedBy: "owner",
      }),
    },
    { description: "SQLite null", value: null },
    { description: "SQLite integer", value: 2n ** 63n - 1n },
  ])("rejects $description", ({ value }) => {
    createSettings().run(backupRetentionSettingKey, value);
    expect(readBackupRetentionPolicy(db)).toEqual({
      policy: null,
      warning: "POLICY_INVALID",
    });
  });
});

describe.skipIf(process.platform === "win32")(
  "backup retention filesystem",
  () => {
    let directory: string;
    beforeEach(async ({ onTestFinished }) => {
      const root = await mkdtemp(join(tmpdir(), "backup-retention-"));
      directory = root;
      onTestFinished(() => rm(root, { recursive: true, force: true }));
    });

    describe("readVerificationReceipt", () => {
      const expectedUid = process.getuid?.() ?? 0;
      const record = { archive: newest.name, verifiedAt: now.toISOString() };
      let path: string;
      beforeEach(() => {
        path = join(directory, "latest.json");
      });

      it.each(["0600", "0640", "0644"])(
        "accepts mode %s for a root-owned receipt",
        async (mode) => {
          await writeFile(path, JSON.stringify(record));
          await chmod(path, mode);
          const info = await lstat(path);
          vi.mocked(lstat).mockResolvedValueOnce(
            Object.assign(info, { uid: 0 }),
          );
          await expect(readVerificationReceipt(path)).resolves.toEqual(record);
        },
      );

      it.each(["0660", "0646", "0650", "0641"])(
        "rejects mode %s with group or other write or execute bits",
        async (mode) => {
          await writeFile(path, JSON.stringify(record));
          await chmod(path, mode);
          await expect(
            readVerificationReceipt(path, { expectedUid }),
          ).resolves.toBeNull();
        },
      );

      it("rejects a receipt owned by a non-root user", async () => {
        await writeFile(path, JSON.stringify(record), { mode: 0o600 });
        const info = await lstat(path);
        vi.mocked(lstat).mockResolvedValueOnce(
          Object.assign(info, { uid: 1000 }),
        );
        await expect(readVerificationReceipt(path)).resolves.toBeNull();
      });

      it("ignores a receipt larger than 4096 bytes", async () => {
        await writeFile(path, JSON.stringify(record).padEnd(4097), {
          mode: 0o600,
        });
        await expect(
          readVerificationReceipt(path, { expectedUid }),
        ).resolves.toBeNull();
      });

      it("ignores a receipt with a bad archive name", async () => {
        await writeFile(
          path,
          JSON.stringify({ ...record, archive: `${newest.name}.partial` }),
          { mode: 0o600 },
        );
        await expect(
          readVerificationReceipt(path, { expectedUid }),
        ).resolves.toBeNull();
      });

      it("returns null when the receipt is missing", async () => {
        await expect(
          readVerificationReceipt(path, { expectedUid }),
        ).resolves.toBeNull();
      });

      it("propagates malformed JSON", async () => {
        await writeFile(path, "{", { mode: 0o600 });
        await expect(
          readVerificationReceipt(path, { expectedUid }),
        ).rejects.toThrow(SyntaxError);
      });
    });

    describe("applyBackupRetention", () => {
      afterEach(() => {
        vi.mocked(unlink).mockReset();
      });

      async function writeArchives(
        ...archives: BackupRetentionOptions["archives"]
      ) {
        for (const { name, bytes } of archives)
          await writeFile(join(directory, name), Buffer.alloc(bytes));
      }

      it("deletes planned files and leaves protected archives and other entries in place", async () => {
        await writeArchives(newest, recent, atAgeLimit, older);
        const link = archive("2026-11-30T00-00-00.000Z").name;
        const folder = archive("2026-11-29T00-00-00.000Z").name;
        const partial = `${newest.name}.partial`;
        await symlink(older.name, join(directory, link));
        await mkdir(join(directory, folder));
        await writeFile(join(directory, partial), "partial");

        expect(
          await applyBackupRetention({
            directory,
            policy: { ...policy, maxGenerations: 2 },
            now,
            latestVerifiedArchive: older.name,
          }),
        ).toEqual({
          configured: true,
          keep: [newest.name, older.name],
          delete: [recent.name, atAgeLimit.name],
          protected: [newest.name, older.name],
          keptBytes: 20,
          deletedBytes: 20,
          warnings: [],
          deleted: [recent.name, atAgeLimit.name],
          alreadyAbsent: [],
        });
        expect((await readdir(directory)).sort()).toEqual(
          [newest.name, older.name, link, folder, partial].sort(),
        );
      });

      it("keeps all archives when the policy is null", async () => {
        await writeArchives(newest, older);
        expect(
          await applyBackupRetention({ directory, policy: null, now }),
        ).toMatchObject({
          configured: false,
          keep: [newest.name, older.name],
          delete: [],
          deleted: [],
          alreadyAbsent: [],
        });
        expect((await readdir(directory)).sort()).toEqual(
          [newest.name, older.name].sort(),
        );
      });

      it("rechecks each candidate after planning", async () => {
        await writeArchives(newest, recent, atAgeLimit, older);
        const absent = join(directory, atAgeLimit.name);
        const replaced = join(directory, older.name);
        const actual =
          await vi.importActual<typeof import("node:fs/promises")>(
            "node:fs/promises",
          );
        vi.mocked(unlink).mockImplementationOnce(async (path) => {
          await actual.unlink(path);
          await actual.unlink(absent);
          await actual.unlink(replaced);
          await symlink(newest.name, replaced);
        });

        expect(
          await applyBackupRetention({
            directory,
            policy: { ...policy, maxGenerations: 1 },
            now,
          }),
        ).toMatchObject({
          delete: [recent.name, atAgeLimit.name, older.name],
          deleted: [recent.name],
          alreadyAbsent: [atAgeLimit.name],
        });
        expect((await lstat(replaced)).isSymbolicLink()).toBe(true);
      });

      it("counts an archive removed between the second lstat and unlink as already absent", async () => {
        await writeArchives(newest, older);
        const actual =
          await vi.importActual<typeof import("node:fs/promises")>(
            "node:fs/promises",
          );
        vi.mocked(unlink).mockImplementationOnce(async (path) => {
          await actual.unlink(path);
          await actual.unlink(path);
        });

        expect(
          await applyBackupRetention({
            directory,
            policy: { ...policy, maxGenerations: 1 },
            now,
          }),
        ).toMatchObject({
          delete: [older.name],
          deleted: [],
          alreadyAbsent: [older.name],
        });
        expect(await readdir(directory)).toEqual([newest.name]);
      });
    });

    describe("runPostBackupRetention", () => {
      let databasePath: string;
      let receiptPath: string;
      let log: ReturnType<typeof vi.fn<(line: string) => void>>;

      beforeEach(async () => {
        databasePath = join(directory, "renderer.sqlite3");
        receiptPath = join(directory, "latest.json");
        new DatabaseSync(databasePath).close();
        log = vi.fn();
        for (const { name, bytes } of [newest, recent, older])
          await writeFile(join(directory, name), Buffer.alloc(bytes));
      });

      afterEach(() => {
        vi.mocked(lstat).mockReset();
        vi.mocked(unlink).mockReset();
      });

      function setLivePolicy(value: string) {
        const db = new DatabaseSync(databasePath);
        try {
          db.exec(
            "CREATE TABLE system_settings (key TEXT PRIMARY KEY, value_json)",
          );
          db.prepare("INSERT INTO system_settings VALUES (?, ?)").run(
            backupRetentionSettingKey,
            value,
          );
        } finally {
          db.close();
        }
      }

      async function archives() {
        return (await readdir(directory))
          .filter((name) => archivePattern.test(name))
          .sort();
      }

      async function runRetention(path = receiptPath) {
        await runPostBackupRetention({
          databasePath,
          directory,
          receiptPath: path,
          statePath: null,
          now,
          log,
        });
        expect(log).toHaveBeenCalledTimes(1);
        return JSON.parse(log.mock.calls[0]?.[0] ?? "") as unknown;
      }

      const oneGeneration = JSON.stringify({
        ...policy,
        maxGenerations: 1,
        confirmedAt: now.toISOString(),
        confirmedBy: "owner",
      });

      it("applies the live policy and protects the archive named in the receipt", async () => {
        setLivePolicy(oneGeneration);
        await writeFile(
          receiptPath,
          JSON.stringify({
            archive: older.name,
            verifiedAt: now.toISOString(),
          }),
          { mode: 0o600 },
        );
        const receiptStat = await lstat(receiptPath);
        vi.mocked(lstat).mockResolvedValueOnce(
          Object.assign(receiptStat, { uid: 0 }),
        );

        expect(await runRetention()).toEqual({
          event: "backup.retention",
          configured: true,
          deleted: [recent.name],
          alreadyAbsent: [],
          keptCount: 2,
          keptBytes: 20,
          deletedBytes: 10,
          warnings: ["PROTECTED_OVER_GENERATIONS"],
        });
        expect(await archives()).toEqual([older.name, newest.name]);
      });

      it("prunes normally when the receipt is missing", async () => {
        setLivePolicy(oneGeneration);
        expect(await runRetention()).toMatchObject({
          event: "backup.retention",
          configured: true,
          deleted: [recent.name, older.name],
          warnings: [],
        });
        expect(await archives()).toEqual([newest.name]);
      });

      it.each([false, true])(
        "keeps all backups without a usable policy (invalid: %s)",
        async (invalid) => {
          if (invalid) setLivePolicy("{}");
          expect(await runRetention()).toEqual({
            event: "backup.retention",
            configured: false,
            deleted: [],
            alreadyAbsent: [],
            keptCount: 3,
            keptBytes: 30,
            deletedBytes: 0,
            warnings: invalid ? ["POLICY_INVALID"] : [],
          });
          expect(await archives()).toEqual([
            older.name,
            recent.name,
            newest.name,
          ]);
        },
      );

      it("skips all deletions when the receipt reader throws", async () => {
        setLivePolicy(oneGeneration);
        const unreadablePath = join(databasePath, "latest.json");
        expect(await runRetention(unreadablePath)).toMatchObject({
          event: "backup.retention_failed",
          warnings: ["RECEIPT_UNREADABLE", "PRUNE_FAILED"],
          message: expect.stringContaining("ENOTDIR") as unknown,
        });
        expect(vi.mocked(unlink)).not.toHaveBeenCalled();
        expect(await archives()).toEqual([
          older.name,
          recent.name,
          newest.name,
        ]);
      });

      it("logs a pruning failure without throwing", async () => {
        setLivePolicy(oneGeneration);
        vi.mocked(unlink).mockRejectedValueOnce(new Error("Could not unlink"));
        expect(await runRetention()).toEqual({
          event: "backup.retention_failed",
          message: "Could not unlink",
          deleted: [],
          warnings: ["PRUNE_FAILED"],
        });
        expect(await archives()).toEqual([
          older.name,
          recent.name,
          newest.name,
        ]);
      });
    });
  },
);
