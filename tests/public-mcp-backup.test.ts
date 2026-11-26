import { execFile, spawnSync } from "node:child_process";
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  backUpGatewayDatabase,
  gatewayBackupRetentionMs,
  prepareRestoredGatewayDatabase,
  pruneGatewayBackups,
} from "../apps/public-mcp-gateway/src/backup.js";
import { SqliteConnectionStore } from "../apps/public-mcp-gateway/src/sqlite-connections.js";

const run = promisify(execFile);
const fixtureDate = Date.parse("2026-11-26T00:00:00.000Z");
const encryptedBackup =
  "public-mcp-2026-11-19T00-00-00.000Z-00000000000000000000000000000000.sqlite.age";

describe.skipIf(process.platform === "win32")(
  "gateway backup retention",
  () => {
    it("prunes only named encrypted backups seven days after creation", async () => {
      const directory = await mkdtemp(join(tmpdir(), "public-mcp-retention-"));
      try {
        await chmod(directory, 0o700);
        const candidate = join(directory, encryptedBackup);
        const target = join(directory, "unrelated");
        const pointedAt = join(
          directory,
          encryptedBackup.replace(/0{32}/, "a".repeat(32)),
        );
        await writeFile(candidate, "fixture ciphertext");
        await writeFile(target, "untouched");
        await symlink(target, pointedAt);
        expect(gatewayBackupRetentionMs).toBe(7 * 24 * 60 * 60 * 1000);
        expect(await pruneGatewayBackups(directory, fixtureDate - 1)).toBe(0);
        expect(await pruneGatewayBackups(directory, fixtureDate)).toBe(1);
        expect((await readdir(directory)).sort()).toEqual(
          [basename(pointedAt), "unrelated"].sort(),
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  },
);

const hasAge =
  process.platform !== "win32" &&
  spawnSync("age", ["--version"]).status === 0 &&
  spawnSync("age-keygen", ["--version"]).status === 0;

it.skipIf(!hasAge)(
  "restores an age-encrypted backup and invalidates the recovered agents and approvals",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "public-mcp-backup-"));
    try {
      await chmod(directory, 0o700);
      const databasePath = join(directory, "gateway.sqlite");
      const store = new SqliteConnectionStore(databasePath);
      try {
        store.putVerifiedInstance({
          id: "instance",
          publicKey: "instance-key",
        });
        const expected = store.profileFor("instance", "local-account");
        const agent = store.addTransport("instance", {
          kind: "agent",
          publicKey: "old-agent",
        });
        const grant = store.createAuthorization(
          {
            profileId: expected.id,
            transportId: agent.id,
            localGrantId: "old-grant",
            scopes: ["mcp:read"],
            expiresAt: fixtureDate + 600_000,
          },
          fixtureDate,
        );
        const identity = join(directory, "age-key");
        await run("age-keygen", ["-o", identity]);
        const recipientFile = join(directory, "age-recipient");
        const { stdout } = await run("age-keygen", ["-y", identity]);
        await writeFile(recipientFile, stdout, { mode: 0o600 });
        const backup = await backUpGatewayDatabase({
          databasePath,
          backupDirectory: directory,
          recipientFile,
          now: fixtureDate,
          signal: new AbortController().signal,
        });
        expect((await readFile(backup)).includes("local-account")).toBe(false);
        expect(
          (await readdir(directory)).some((name) =>
            name.startsWith(".public-mcp-backup-"),
          ),
        ).toBe(false);
        const recovered = join(directory, "decrypted.sqlite");
        const restore = {
          backupPath: backup,
          destination: recovered,
          identityFile: identity,
          now: fixtureDate + 1,
          signal: new AbortController().signal,
        };
        expect(await prepareRestoredGatewayDatabase(restore)).toBe(1);
        await expect(prepareRestoredGatewayDatabase(restore)).rejects.toThrow(
          "unused destination",
        );
        const copy = new SqliteConnectionStore(recovered);
        try {
          expect(copy.profile(expected.id)).toEqual(expected);
          expect(copy.transport(agent.id)?.disabledAt).toBe(restore.now);
          expect(copy.authorization(grant.id)?.revokedAt).toBe(restore.now);
        } finally {
          copy.close();
        }
      } finally {
        store.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
