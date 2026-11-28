import { expect, it, vi } from "vitest";
import {
  adminCatalog,
  createAdminMessage,
  validateAdminCatalogs,
} from "../apps/admin-web/src/admin-messages.js";
import { createBackups } from "../apps/admin-web/src/browser/admin/backups.js";
import { createControls } from "../apps/admin-web/src/browser/admin/controls.js";

const retentionStatus = {
  schedule: "daily",
  policy: null,
  candidates: null,
  plan: { delete: [], protected: [], warnings: [] },
  proposedPlan: null,
  lastRun: null,
};

it.each([false, true])(
  "keeps backup actions usable without suggested limits (retention unavailable=%s)",
  async (unavailable) => {
    const root = { innerHTML: "", isConnected: true };
    const out = {
      insertAdjacentHTML: vi.fn(),
      querySelector: vi.fn(() => root),
    } as unknown as HTMLElement;
    const request = vi.fn((path: string) => {
      if (path === "/backups/status")
        return Promise.resolve({
          backup: { active: "inactive", result: "success" },
          verification: { active: "inactive", result: "success" },
          latestVerification: null,
        });
      return unavailable
        ? Promise.reject(new Error("Backup control unavailable"))
        : Promise.resolve(retentionStatus);
    });
    const input = {
      adminMessage: createAdminMessage(adminCatalog("en")),
      out,
      err: out,
      ok: out,
      me: { role: "owner" as const },
      request,
    };
    const bindAction = vi.fn();
    await createBackups({
      ...input,
      ...createControls({ ...input, refreshPage: () => Promise.resolve() }),
      bindAction,
    }).backups();

    expect(request.mock.calls).toEqual([
      ["/backups/status"],
      ["/backups/retention"],
    ]);
    expect(bindAction).toHaveBeenCalledWith(
      "[data-backup]",
      expect.any(Function),
    );
    expect(root.innerHTML).toContain("Create backup");
    expect(root.innerHTML).toContain("Verify latest backup");
    expect(root.innerHTML).not.toContain("retention-form");
    expect(root.innerHTML).toContain(
      unavailable
        ? "Could not load backup retention status."
        : "Create the first backup to get suggested limits.",
    );
  },
);

it("provides the backup retention messages and placeholders in every admin locale", () => {
  expect(validateAdminCatalogs()).toEqual([]);
});
