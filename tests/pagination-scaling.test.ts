import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";
import { RemoteRenderService } from "../packages/remote-mcp-core/src/index.js";

const databases: RendererDatabase[] = [];
const roots: string[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("keyset pagination and query scaling", () => {
  it("uses stable cursors and SQL-side summaries for project/job/source pages", () => {
    const database = fixture(),
      timestamp = "2026-08-31T00:00:00.000Z";
    for (let index = 0; index < 3; index++) {
      const projectId = `project_${index}`;
      database.projects.insert({
        id: projectId,
        ownerUserId: "user_test",
        displayName: `Project ${index}`,
        timestamp,
      });
      const sourceId = `source_${index}`;
      database.sources.insertReserved({
        id: sourceId,
        ownerUserId: "user_test",
        size: 10,
        sha256: String(index).repeat(64),
        storageKey: `sources/${sourceId}/source.zip`,
        timestamp,
        expiresAt: "2027-01-01T00:00:00.000Z",
      });
      database.projects.insertRevision({
        id: `revision_${index}`,
        projectId,
        sourceId,
        displayName: `Revision ${index}`,
        originalFilename: "main.zip",
        entrypoint: "main.tex",
        timestamp,
      });
      database.jobs.insertReserved({
        id: `job_${index}`,
        userId: "user_test",
        serviceAccountId: "sa_test",
        apiKeyId: "key_test",
        rendererVersion: "test",
        sourceSize: 10,
        sourceSha256: String(index).repeat(64),
        sourceId,
        projectRevisionId: `revision_${index}`,
        timestamp,
        reservedOutputBytes: 0,
      });
    }

    const firstProjects = database.projects.listOwnedPage("user_test", {
      limit: 2,
    });
    expect(firstProjects.items).toHaveLength(2);
    expect(firstProjects.hasMore).toBe(true);
    const secondProjects = database.projects.listOwnedPage("user_test", {
      limit: 2,
      cursor: firstProjects.nextCursor ?? undefined,
    });
    expect(secondProjects.items).toHaveLength(1);
    expect(
      new Set(
        [...firstProjects.items, ...secondProjects.items].map((row) => row.id),
      ).size,
    ).toBe(3);
    expect(firstProjects.items[0]?.revision_count).toBe(1);
    expect(firstProjects.items[0]?.latest_revision_id).toMatch(/^revision_/);

    const jobs = database.jobs.listOwnedPage("user_test", { limit: 2 });
    expect(jobs.items).toHaveLength(2);
    expect(jobs.items[0]).toHaveProperty("project_name");
    const sources = database.sources.listPage({ limit: 2 });
    expect(sources.items).toHaveLength(2);
    expect(sources.items[0]?.job_count).toBe(1);
    // Both the active Job and active Project revision block Source deletion.
    expect(sources.items[0]?.blocking_reference_count).toBe(2);
    const firstSource = sources.items[0];
    expect(firstSource).toBeDefined();
    if (firstSource === undefined) throw new Error("Source fixture is missing");
    const sourceJobs = database.jobs.listBySourcePage(firstSource.id, {
      limit: 10,
    });
    expect(sourceJobs.items).toHaveLength(1);
  });

  it("refreshes Remote MCP environment inventory after an image list changes", async () => {
    const database = fixture(),
      root = mkdtempSync(join(tmpdir(), "latex-environment-cache-"));
    roots.push(root);
    writeFileSync(join(root, "packages.txt"), "latexmk\n");
    writeFileSync(join(root, "fonts.txt"), "Harano Aji\n");
    const service = new RemoteRenderService(
      database,
      root,
      "renderer:test",
      "https://latex.example.com",
      100,
      1024 * 1024,
      root,
    );
    const identity = { userId: "user_test", scopes: ["mcp:read"] as const };
    await expect(
      service.checkPackages(identity, ["latexmk", "new-package"]),
    ).resolves.toEqual([
      { name: "latexmk", available: true },
      { name: "new-package", available: false },
    ]);
    writeFileSync(join(root, "packages.txt"), "new-package\n");
    await expect(
      service.checkPackages(identity, ["latexmk", "new-package"]),
    ).resolves.toEqual([
      { name: "latexmk", available: false },
      { name: "new-package", available: true },
    ]);
  });
});

function fixture(): RendererDatabase {
  const database = new RendererDatabase(":memory:");
  database.migrate();
  databases.push(database);
  const timestamp = "2026-08-30T00:00:00.000Z";
  database.users.insertInvitation({
    id: "user_test",
    email: "user@example.test",
    displayName: "Test User",
    role: "user",
    createdBy: "test",
    timestamp,
  });
  database.serviceAccounts.insert({
    id: "sa_test",
    ownerUserId: "user_test",
    name: "Test",
    clientType: "generic",
    timestamp,
  });
  database.apiKeys.insert({
    id: "key_test",
    serviceAccountId: "sa_test",
    name: "Test",
    prefix: "test-prefix",
    kind: "render",
    secretHash: "0".repeat(64),
    pepperId: "test",
    scopes: ["render:create"],
    createdAt: timestamp,
    createdBy: "test",
  });
  return database;
}
