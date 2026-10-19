import { lstat, opendir, readFile, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { boundedIntegerEnvironment } from "./environment.mjs";

/** The timer and Worker use the same collector. Recursive deletion never holds
 * the DB lock; a deleting row keeps its reserved bytes until real removal. */
export async function collectSourceTrees(
  db,
  storageRoot,
  pressure = false,
  maximum = 32,
  maximumBytes = boundedIntegerEnvironment(
    process.env,
    "SOURCE_TREE_MAX_BYTES",
    64 * 1024 ** 2,
    0,
    1024 ** 3,
  ),
  maximumUserBytes = boundedIntegerEnvironment(
    process.env,
    "SOURCE_TREE_USER_MAX_BYTES",
    32 * 1024 ** 2,
    0,
    1024 ** 3,
  ),
) {
  for (let n = 0; n < maximum; n++) {
    let row;
    db.exec("BEGIN IMMEDIATE");
    try {
      row = db
        .prepare(
          `SELECT * FROM source_trees t WHERE NOT EXISTS (SELECT 1 FROM source_tree_readers r WHERE r.tree_id=t.id)
        AND (? OR (SELECT COALESCE(SUM(reserved_bytes),0) FROM source_trees)>?
          OR (SELECT COALESCE(SUM(owned.reserved_bytes),0) FROM source_trees owned WHERE owned.owner_user_id=t.owner_user_id)>?
          OR t.status IN ('building','invalid','deleting') OR t.expires_at<=?
          OR NOT EXISTS (SELECT 1 FROM sources s WHERE s.id=t.source_id AND s.status='ready' AND s.owner_user_id=t.owner_user_id))
        ORDER BY CASE WHEN t.status='deleting' THEN 0 WHEN t.status!='ready' THEN 1 ELSE 2 END,t.last_used_at,t.id LIMIT 1`,
        )
        .get(
          pressure ? 1 : 0,
          maximumBytes,
          maximumUserBytes,
          new Date().toISOString(),
        );
      if (row)
        db.prepare("UPDATE source_trees SET status='deleting' WHERE id=?").run(
          row.id,
        );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    if (!row) return;
    if (typeof row.id !== "string" || !/^tree_[a-f0-9]{32}$/.test(row.id))
      throw new Error("Invalid Source tree identity");
    const root = await realpath(resolve(storageRoot)),
      parent = join(root, "source-trees"),
      target = join(parent, row.id);
    let missing = false;
    try {
      await lstat(target);
    } catch (error) {
      if (error?.code === "ENOENT") missing = true;
      else throw error;
    }
    if (!missing) {
      const info = await lstat(root);
      if (
        (await realpath(root)) !== root ||
        (await realpath(parent)) !== parent ||
        (await realpath(target)) !== target ||
        (await lstat(target)).dev !== info.dev ||
        !(await lstat(target)).isDirectory()
      )
        throw new Error("Unsafe Source tree cleanup path");
      if (process.platform === "linux") {
        const mounts = (await readFile("/proc/self/mountinfo", "utf8"))
          .split("\n")
          .map((line) => line.split(" ")[4])
          .filter(Boolean)
          .map((p) =>
            p.replace(/\\([0-7]{3})/g, (_, s) =>
              String.fromCharCode(parseInt(s, 8)),
            ),
          );
        if (mounts.some((p) => p === target || p.startsWith(target + "/")))
          throw new Error("Unexpected Source tree mount");
      }
      const pending = [target];
      let count = 0;
      while (pending.length) {
        const directory = pending.pop();
        for await (const entry of await opendir(directory, {
          bufferSize: 32,
        })) {
          if (++count > 20000)
            throw new Error("Source tree cleanup exceeds entry bound");
          const path = join(directory, entry.name),
            child = await lstat(path);
          if (child.dev !== info.dev)
            throw new Error("Unexpected Source tree device");
          if (child.isDirectory()) pending.push(path);
          // Symlinks are unlinked, never traversed, by rm.
        }
      }
      await rm(target, { recursive: true, force: true });
    }
    db.prepare(
      "DELETE FROM source_trees WHERE id=? AND status='deleting' AND NOT EXISTS (SELECT 1 FROM source_tree_readers WHERE tree_id=?)",
    ).run(row.id, row.id);
  }
}
