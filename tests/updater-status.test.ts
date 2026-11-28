import { japaneseAdminMessage } from "./helpers/admin-message.js";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import {
  UpdaterSlots,
  updaterEnvelope,
  UPDATER_FILES,
} from "../deploy/scripts/updater-slots.mjs";
import {
  updaterStatus,
  expectedUpdater,
  updateOutcome,
} from "../deploy/scripts/updater-status.mjs";
import { runInNewContext } from "node:vm";
import { updateViewSource as part7 } from "./helpers/admin-ui-source.js";
import { installAdmin } from "../apps/admin-web/src/browser/admin/controller.js";
import { adminCatalog } from "../apps/admin-web/src/admin-messages.js";

const roots: string[] = [];
afterEach(async () => {
  for (const path of roots.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "updater-status-"));
  roots.push(root);
  const source = join(root, "source"),
    slots = new UpdaterSlots(join(root, "slots-root"));
  await mkdir(join(source, "deploy/scripts"), { recursive: true, mode: 0o755 });
  for (const path of UPDATER_FILES)
    await writeFile(join(source, path), `fixture ${path}`, { mode: 0o644 });
  await writeFile(
    join(source, "deploy/updater-files.json"),
    JSON.stringify(UPDATER_FILES),
    { mode: 0o644 },
  );
  const envelope = await updaterEnvelope(source, {
    version: "9.0.0",
    commit: "a".repeat(40),
  });
  const id = await slots.stage(source, envelope);
  await slots.nominate(id);
  return {
    source,
    slots,
    envelope,
    id,
    runningRoot: join(slots.root, "slots", id),
  };
}
it("reports the verified running controller without changing the journal", async () => {
  const f = await fixture(),
    before = await readFile(join(f.slots.root, "state.json"));
  expect(await updaterStatus(f)).toMatchObject({
    status: "ready",
    running: expectedUpdater(f.envelope),
  });
  expect(await readFile(join(f.slots.root, "state.json"))).toEqual(before);
});
it("does not call a nominated or pending activation complete", async () => {
  const f = await fixture();
  const id = await f.slots.stage(f.source, { ...f.envelope, version: "9.1.0" });
  await f.slots.nominate(id);
  expect(await updaterStatus(f)).toMatchObject({
    status: "activating",
    running: { slotId: f.id },
    candidateSlotId: id,
  });
  await f.slots.begin();
  expect(
    await updaterStatus({ ...f, runningRoot: join(f.slots.root, "slots", id) }),
  ).toMatchObject({ status: "activating", pending: true });
  await f.slots.finish();
  expect(
    await updaterStatus({ ...f, runningRoot: join(f.slots.root, "slots", id) }),
  ).toMatchObject({ status: "ready" });
});
it("fails closed on corrupt state, tampering or an application-directory controller", async () => {
  const f = await fixture();
  expect((await updaterStatus({ ...f, runningRoot: f.source })).status).toBe(
    "unavailable",
  );
  await writeFile(join(f.runningRoot, "package.json"), "tampered");
  expect((await updaterStatus(f)).status).toBe("unavailable");
  await writeFile(join(f.slots.root, "state.json"), "broken");
  expect((await updaterStatus(f)).status).toBe("unavailable");
});
it("detects a journal switch during a read", async () => {
  const f = await fixture(),
    state = await f.slots.state();
  vi.spyOn(f.slots, "state")
    .mockResolvedValueOnce(state)
    .mockResolvedValueOnce({ ...state, candidate: "b".repeat(64) });
  expect((await updaterStatus(f)).status).toBe("activating");
});
it("only reports combined success for an exact committed slot identity", async () => {
  const f = await fixture(),
    status = await updaterStatus(f);
  const operation = {
    status: "succeeded",
    type: "apply",
    expectedUpdater: expectedUpdater(f.envelope),
    finishedAt: new Date().toISOString(),
  };
  expect(updateOutcome(operation, status).complete).toBe(true);
  expect(
    updateOutcome(
      {
        ...operation,
        expectedUpdater: {
          ...operation.expectedUpdater,
          slotId: "b".repeat(64),
        },
      },
      status,
    ).complete,
  ).toBe(false);
  expect(
    updateOutcome({ ...operation, status: "failed" }, status).complete,
  ).toBe(false);
  expect(
    updateOutcome({ ...operation, expectedUpdater: null }, status).updater,
  ).toBe("legacy-unconfirmed");
  const activating = { ...status, status: "activating", candidateSlotId: f.id };
  expect(updateOutcome(operation, activating).updater).toBe("activating");
  expect(
    updateOutcome(operation, activating, Date.now() + 11 * 60_000).updater,
  ).toBe("needs-attention");
});
it("renders application success separately until controller activation is confirmed", () => {
  const label = (operation: unknown): unknown =>
    runInNewContext(`${part7}\nupdateOperationLabel(operation)`, { operation, adminMessage: japaneseAdminMessage });
  expect(label({ status: "succeeded" })).toBe("アプリ更新済み・Updater要確認");
  expect(
    label({ status: "succeeded", outcome: { updater: "activating" } }),
  ).toBe("アプリ更新済み・Updater切替待ち");
  expect(label({ status: "succeeded", outcome: { complete: true } })).toBe(
    "正常に完了",
  );
});

it("aborts the update poll on pagehide and reconnects on return", async () => {
  vi.useFakeTimers();
  class ElementFixture {
    readonly dataset: Record<string, string> = {};
    textContent = "";
    children: ElementFixture[] = [];
    isConnected = true;
    constructor(readonly tag: string) {}
    get firstElementChild() {
      return this.children[0];
    }
    append(...children: ElementFixture[]) {
      this.children.push(...children);
    }
    replaceChildren() {
      this.children = [];
    }
    querySelector(selector: string): ElementFixture | null {
      for (const child of this.children) {
        if (child.tag === selector) return child;
        const match = child.querySelector(selector);
        if (match) return match;
      }
      return null;
    }
    addEventListener() {}
  }
  const elements = new Map(
    [
      "#content",
      "#error",
      "#success",
      "#identity",
      "#updated",
      "#update-operation",
      "#update-policy-form",
      "#update-check",
      "#update-apply",
      "#update-rollback",
    ].map((selector) => [selector, new ElementFixture(selector)]),
  );
  const target = elements.get("#update-operation");
  const catalog = adminCatalog("en");
  const operation = { id: "op-fixture", status: "running", log: "Installing" };
  const completed = {
    ...operation,
    status: "succeeded",
    log: "Done",
    outcome: { complete: true },
  };
  const polls: AbortSignal[] = [];
  let finished = false;
  const startPage = () => {
    const events = new EventTarget();
    vi.stubGlobal("addEventListener", events.addEventListener.bind(events));
    installAdmin(catalog);
    return events;
  };
  try {
    vi.stubGlobal("document", {
      documentElement: { lang: "en" },
      body: { dataset: { page: "updates" } },
      querySelectorAll: () => [],
      querySelector: (selector: string) =>
        selector === "#update-operation > article"
          ? target?.firstElementChild
          : elements.get(selector),
      createElement: (tag: string) => new ElementFixture(tag),
    });
    vi.stubGlobal("location", {
      href: "https://renderer.invalid/admin/updates/",
    });
    vi.stubGlobal("fetch", (path: string, options: RequestInit) => {
      if (path === "/auth/session")
        return Promise.resolve(Response.json({ csrfToken: "fixture" }));
      if (path === "/admin/api/v1/me")
        return Promise.resolve(Response.json({ role: "owner" }));
      if (path === "/admin/api/v1/updates/state")
        return Promise.resolve(
          Response.json(
            finished
              ? { lastOperationId: operation.id }
              : { activeOperationId: operation.id },
          ),
        );
      if (
        path !== "/admin/api/v1/updates/operations/op-fixture" ||
        !options.signal
      )
        throw new Error(`Unexpected fixture request ${path}`);
      const { signal } = options;
      polls.push(signal);
      if (polls.length === 2)
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Poll aborted", "AbortError")),
            { once: true },
          );
        });
      if (polls.length === 4) finished = true;
      return Promise.resolve(Response.json(finished ? completed : operation));
    });

    const first = startPage();
    await vi.advanceTimersByTimeAsync(1500);
    expect(polls).toHaveLength(2);
    expect(polls[0]).toBe(polls[1]);
    first.dispatchEvent(new Event("pagehide"));
    expect(polls[1]?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(polls).toHaveLength(2);

    startPage();
    await vi.advanceTimersByTimeAsync(1500);
    expect(polls).toHaveLength(5);
    expect(polls[2]).toBe(polls[3]);
    expect(polls[3]?.aborted).toBe(true);
    expect(target?.querySelector("pre")?.textContent).toBe(completed.log);
    expect(elements.get("#success")?.textContent).toBe(
      catalog.confirmedThatTheApplicationAndUpdater,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(polls).toHaveLength(5);
    expect(elements.get("#error")?.textContent).toBe("");
  } finally {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
