import { execFile } from "node:child_process";
import {
  chmod,
  mkdtemp,
  mkdir,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";
import { readAuditCheckpoint } from "../deploy/scripts/audit-checkpoint.mjs";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("bounded audit export", () => {
  it("advances the durable checkpoint after each bounded batch", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-audit-export-"));
    roots.push(root);
    const databasePath = join(root, "renderer.sqlite3"),
      destination = join(root, "backups"),
      checkpointPath = join(root, "audit", "checkpoint"),
      bin = join(root, "bin"),
      age = join(bin, "age");
    await mkdir(bin, { recursive: true });
    await writeFile(
      age,
      `#!/usr/bin/env node
const { copyFileSync } = require("node:fs");
const args = process.argv.slice(2);
copyFileSync(args.at(-1), args[args.indexOf("-o") + 1]);
`,
      { mode: 0o700 },
    );
    await chmod(age, 0o700);
    const database = new RendererDatabase(databasePath);
    database.migrate();
    const insert = database.raw.prepare(
      `INSERT INTO audit_logs(
         id,actor_type,actor_id,action,target_type,target_id,result,
         metadata_json,created_at
       ) VALUES (?,'system','test','test.action','test','test','success','{}',?)`,
    );
    for (let index = 1; index <= 5; index += 1)
      insert.run(
        `audit_${String(index).padStart(3, "0")}`,
        `2026-08-30T00:00:0${index}.000Z`,
      );
    database.close();

    const { stdout } = await execFileAsync(
      process.execPath,
      [join(process.cwd(), "deploy/scripts/audit-export.mjs")],
      {
        env: {
          ...process.env,
          PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
          DATABASE_PATH: databasePath,
          BACKUP_DIRECTORY: destination,
          BACKUP_AGE_RECIPIENT_FILE: join(root, "recipient"),
          AUDIT_EXPORT_CHECKPOINT: checkpointPath,
          AUDIT_EXPORT_BATCH_SIZE: "2",
          AUDIT_EXPORT_MAX_BATCHES: "10",
        },
      },
    );
    expect(JSON.parse(stdout)).toMatchObject({ count: 5, batches: 3 });
    expect((await readdir(destination)).filter((name) => name.endsWith(".age")))
      .toHaveLength(3);
    await expect(readAuditCheckpoint(checkpointPath)).resolves.toEqual({
      createdAt: "2026-08-30T00:00:05.000Z",
      id: "audit_005",
    });
  });
});
