import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  INITIAL_APPLICATION_UNITS,
  requireInitialApplicationStopped,
} from "../deploy/scripts/server-setup-prepare.mjs";
import { withScopedContainerEngine } from "../deploy/scripts/on-demand-engine.mjs";
import { runtimeEnvironment } from "../deploy/scripts/runtime-mode.mjs";

it("installs templates without querying a bare template as an instance", () => {
  const queried: string[] = [];
  requireInitialApplicationStopped((...args: string[]) => {
    const unit = args.at(-1) ?? "";
    if (unit.includes("@.")) throw new Error("Invalid template invocation");
    queried.push(unit);
    return unit.endsWith("authentication-recovery.service")
      ? "active\n"
      : "inactive\n";
  });
  expect(INITIAL_APPLICATION_UNITS).toContain("latex-renderer-status@.service");
  expect(queried).not.toContain("latex-renderer-status@.service");
  expect(queried).toContain("latex-renderer-status.socket");
  for (const state of ["active", "activating", "deactivating"])
    expect(() => requireInitialApplicationStopped(() => state)).toThrow(
      "must be stopped",
    );
  requireInitialApplicationStopped(() => "failed");
});

it("includes LAN services and declares recovery before the passive socket explicitly", () => {
  for (const unit of [
    "lan-https.service",
    "lan-renew.service",
    "lan-renew.timer",
  ])
    expect(INITIAL_APPLICATION_UNITS).toContain(`latex-renderer-${unit}`);
  const recovery = readFileSync(
    "deploy/systemd/latex-renderer-authentication-recovery.service",
    "utf8",
  );
  expect(recovery.split("\n")).toContain("Before=latex-renderer-status.socket");
});

it("protects only the compact inspection and releases its lease on success or failure", async () => {
  const events: string[] = [];
  const prepare = () => {
    events.push("ready");
    return Promise.resolve({
      release: () => {
        events.push("release");
        return Promise.resolve();
      },
    });
  };
  const compact = runtimeEnvironment(
    'RENDERER_RUNTIME_MODE="compact"\nWORKER_IDLE_ENABLED=true\n',
  );
  expect(
    await withScopedContainerEngine(
      () => {
        events.push("inspect");
        return "image";
      },
      compact,
      { prepare },
    ),
  ).toBe("image");
  expect(events.splice(0)).toEqual(["ready", "inspect", "release"]);
  await expect(
    withScopedContainerEngine(
      () => {
        throw new Error("inspection failed");
      },
      compact,
      { prepare },
    ),
  ).rejects.toThrow("inspection failed");
  expect(events.splice(0)).toEqual(["ready", "release"]);
  await withScopedContainerEngine(
    () => {
      events.push("classic");
    },
    {},
    { prepare },
  );
  expect(events).toEqual(["classic"]);
  await expect(
    withScopedContainerEngine(
      () => {
        events.push("never");
      },
      compact,
      {
        prepare: () => Promise.reject(new Error("engine failed")),
      },
    ),
  ).rejects.toThrow("engine failed");
  expect(events).toEqual(["classic"]);
});
