import { describe, expect, it } from "vitest";
import {
  type BackupRetentionOptions,
  archivePattern,
  planBackupRetention,
} from "../deploy/scripts/backup-retention.mjs";

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
    "requires %s to be a positive safe integer",
    (limit) => {
      for (const value of [undefined, 0, -1, 1.5, 2 ** 53, "1"]) {
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
