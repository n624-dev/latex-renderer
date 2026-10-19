import { defined } from "./helpers/assert-defined.js";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import {
  eligibleManagedImage,
  retainedPreviewRuntimeIds,
} from "../deploy/scripts/image-cleanup-policy.mjs";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const old = `sha256:${"a".repeat(64)}`,
  current = `sha256:${"b".repeat(64)}`,
  previous = `sha256:${"c".repeat(64)}`;
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "preview-image-retention-"));
  roots.push(root);
  const path = join(root, "db.sqlite"),
    db = new DatabaseSync(path);
  db.exec(`CREATE TABLE job_preview_documents(job_id TEXT,pdf_artifact_id TEXT,pdf_sha256 TEXT,runtime_image TEXT);
    CREATE TABLE artifacts(id TEXT,job_id TEXT,relative_path TEXT,type TEXT,sha256 TEXT);
    CREATE TABLE job_preview_requests(job_id TEXT,status TEXT);
    INSERT INTO job_preview_documents VALUES ('job','pdf','digest','${old}');
    INSERT INTO artifacts VALUES ('pdf','job','result.pdf','pdf','digest');`);
  return { path, db };
}
describe("retained PDF Runtime lifetime", () => {
  it("pins the exact image until the PDF is actually removed and uncertain preview work is recovered", async () => {
    const f = await fixture();
    try {
      expect([...retainedPreviewRuntimeIds(f.path)]).toEqual([old]);
      f.db.exec(
        "DELETE FROM artifacts; INSERT INTO job_preview_requests VALUES ('job','running')",
      );
      expect([...retainedPreviewRuntimeIds(f.path)]).toEqual([old]);
      f.db.exec("UPDATE job_preview_requests SET status='failed'");
      expect([...retainedPreviewRuntimeIds(f.path)]).toEqual([]);
    } finally {
      f.db.close();
    }
  });
  it("does not pin a mismatched PDF descriptor", async () => {
    const f = await fixture();
    try {
      f.db.exec("UPDATE artifacts SET sha256='changed'");
      expect(retainedPreviewRuntimeIds(f.path).size).toBe(0);
    } finally {
      f.db.close();
    }
  });
  it("fails closed on malformed database or invalid pinned identity", async () => {
    const f = await fixture();
    try {
      f.db.exec("UPDATE job_preview_documents SET runtime_image='--all'");
      expect(() => retainedPreviewRuntimeIds(f.path)).toThrow("identity");
    } finally {
      f.db.close();
    }
    await writeFile(f.path, "not sqlite");
    expect(() => retainedPreviewRuntimeIds(f.path)).toThrow();
    expect(() => retainedPreviewRuntimeIds(join(f.path, "missing"))).toThrow();
  });
  it("supports pre-preview databases without creating tables", async () => {
    const f = await fixture();
    try {
      f.db.exec("DROP TABLE job_preview_documents");
      expect(retainedPreviewRuntimeIds(f.path).size).toBe(0);
    } finally {
      f.db.close();
    }
  });
  it("executes actual manager cleanup without removing retained Runtime A after A→B→C", async () => {
    const f = await fixture();
    try {
      const source = await readFile("deploy/scripts/image-manager.mjs", "utf8"),
        cleanup = source.slice(
          source.indexOf("async function cleanup(op,"),
          source.indexOf("\nfunction sameLanguages"),
        ),
        removed: string[] = [];
      const context = {
        process: { env: { DATABASE_PATH: f.path } },
        state: {
          current: { runtimeImageId: current },
          previous: { runtimeImageId: previous },
        },
        rendererEnv: "fixture",
        cleanupPolicy: { retentionHours: 24, cacheMaxGiB: 2 },
        retainedPreviewRuntimeIds,
        eligibleManagedImage,
        rendererImageFromEnv: () => current,
        readFile: () => Promise.resolve(""),
        dockerCapture: (args: string[]) =>
          Promise.resolve(
            args[1] === "ls"
              ? [old, previous, current].join("\n")
              : args[args.length - 1] === "{{.Id}}"
                ? current
                : JSON.stringify({
                    Id: old,
                    Created: "2000-01-01T00:00:00Z",
                    Config: {
                      Labels: {
                        "jp.n624.latex-renderer.base-image-id": previous,
                        "jp.n624.latex-renderer.renderer-runtime-fingerprint":
                          "fingerprint",
                      },
                    },
                  }),
          ),
        dockerLogged: (_op: unknown, args: string[]) => {
          if (args[0] === "image") removed.push(defined(args[args.length - 1]));
          return Promise.resolve();
        },
        persistState: () => Promise.resolve(),
        appendLog: () => Promise.resolve(),
      };
      await (runInNewContext(
        `${cleanup}; cleanup({},false)`,
        context,
      ) as Promise<void>);
      expect(removed).toEqual([]);
      f.db.exec("DELETE FROM artifacts");
      await (runInNewContext(
        `${cleanup}; cleanup({},false)`,
        context,
      ) as Promise<void>);
      expect(removed).toEqual([old]);
    } finally {
      f.db.close();
    }
  });
  it("routes update-time removal and generic prune through preview-aware cleanup", async () => {
    const restore = await readFile(
        "deploy/scripts/restore-managed-runtime.sh",
        "utf8",
      ),
      prune = await readFile(
        "deploy/scripts/prune-production-artifacts.sh",
        "utf8",
      );
    expect(restore).not.toContain("rootless_docker image rm");
    expect(prune).toContain('--retained-preview-runtimes "${DATABASE_PATH:');
    expect(prune.indexOf("--retained-preview-runtimes")).toBeLessThan(
      prune.indexOf("rootless_docker image prune"),
    );
  });
});
