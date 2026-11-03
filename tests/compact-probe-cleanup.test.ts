import { expect, it, vi } from "vitest";
import { quiesceProbeAccount } from "../deploy/ci/compact-probe-cleanup.mjs";

it("disables linger before stopping the fresh account and waits for asynchronous process exit", async () => {
  let active = true;
  const run = vi.fn((_file: string, args: string[]) => {
    if (args[0] === "-u") return "12345";
    return "";
  });
  const wait = vi.fn(() => { active = false; return Promise.resolve(); });
  await quiesceProbeAccount({ uid: 12345, workerUid: 995, run, alive: () => active, wait });
  expect(run.mock.calls[1]?.[1]).toEqual(["disable-linger", "latex-render-probe"]);
  expect(run.mock.calls[2]?.[1]).toEqual(["terminate-user", "latex-render-probe"]);
  expect(wait).toHaveBeenCalled();
  expect(run.mock.calls.some(([file]) => file.includes("pkill"))).toBe(false);
});

it("removes only fresh-account residual processes and refuses the renderer UID or an identity change", async () => {
  let active = true;
  const run = vi.fn((file: string) => {
    if (file.endsWith("/id")) return "12345";
    if (file.endsWith("/pkill")) active = false;
    return "";
  });
  const options = { uid: 12345, workerUid: 995, run, alive: () => active, wait: () => Promise.resolve() };
  await quiesceProbeAccount(options);
  expect(run).toHaveBeenCalledWith("/usr/bin/pkill", ["--signal", "KILL", "--uid", "12345"]);
  run.mockClear();
  await expect(quiesceProbeAccount({ ...options, workerUid: 12345 })).rejects.toThrow("unrelated");
  expect(run).not.toHaveBeenCalled();
  await expect(quiesceProbeAccount({ ...options, uid: 12346 })).rejects.toThrow("unrelated");
});

it("accepts an already exited login manager only after all account processes are gone", async () => {
  const run = (_file: string, args: string[]) => {
    if (args[0] === "-u") return "12345";
    if (args[0] === "terminate-user") throw Object.assign(new Error("No session"), { status: 1 });
    return "";
  };
  await expect(quiesceProbeAccount({ uid: 12345, workerUid: 995, run, alive: () => false, wait: () => Promise.resolve() })).resolves.toBeUndefined();
});
