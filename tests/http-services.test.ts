import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import {
  controlService,
  controlServices,
  httpServiceStatus,
  prepareHttpActivation,
  deploymentUpdater,
} from "../deploy/scripts/http-services.mjs";

const unit = "latex-renderer-api.service",
  socket = "latex-renderer-api.socket";

it("preserves a classic Worker when its PartOf manager is restarted", () => {
  const manager = "latex-renderer-image-manager.service";
  const worker = "latex-renderer-worker.service";
  const active = new Set([manager, worker]);
  const calls: string[][] = [];
  const run = (...args: string[]) => {
    calls.push(args);
    const name = args.at(-1) ?? "";
    if (args[0] === "show")
      return `LoadState=loaded\nActiveState=${active.has(name) ? "active" : "inactive"}\n`;
    if (args[0] === "stop") {
      active.delete(name);
      if (name === manager) active.delete(worker);
    }
    if (["start", "restart"].includes(args[0] ?? "")) active.add(name);
    return "";
  };
  controlService("restart", manager, { run, enabled: false });
  expect(active.has(worker)).toBe(true);
  expect(calls).toContainEqual(["restart", manager]);
  calls.length = 0;
  controlServices("restart", [worker, unit, manager], {
    run,
    enabledFor: () => false,
  });
  expect(active.has(worker)).toBe(true);
  expect(calls.filter((args) => args[0] === "restart")).toEqual([
    ["restart", manager],
    ["restart", unit],
    ["restart", worker],
  ]);
});

it("preserves try-restart activity and leaves sleeping services asleep", () => {
  const manager = "latex-renderer-image-manager.service",
    worker = "latex-renderer-worker.service";
  const active = new Set([manager, worker]);
  const starts: string[] = [];
  const run = (...args: string[]) => {
    const name = args.at(-1) ?? "";
    if (args[0] === "show")
      return `LoadState=loaded\nActiveState=${active.has(name) ? "active" : "inactive"}\n`;
    if (args[0] === "stop" && name === manager) active.delete(worker);
    if (args[0] === "start") {
      active.add(name);
      starts.push(name);
    }
    return "";
  };
  controlServices("try-restart", [worker, unit, manager], {
    run,
    enabledFor: () => true,
  });
  expect(starts).toEqual([
    manager.replace(".service", ".socket"),
    worker.replace(".service", ".socket"),
  ]);
  expect(starts).not.toContain(unit.replace(".service", ".socket"));
});
function model(
  service: Record<string, string> = {},
  listener: Record<string, string> = {},
) {
  const calls: string[][] = [];
  const run = (...args: string[]): string => {
    calls.push(args);
    if (args[0] === "show") {
      const properties =
        args.at(-1) === socket
          ? {
              LoadState: "loaded",
              ActiveState: "active",
              SubState: "listening",
              UnitFileState: "enabled",
              ...listener,
            }
          : args.at(-1) === unit
            ? {
                LoadState: "loaded",
                ActiveState: "inactive",
                Result: "success",
                ...service,
              }
            : { LoadState: "not-found", ActiveState: "inactive" };
      return Object.entries(properties)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");
    }
    if (args[0] === "is-enabled") return "enabled\n";
    return "";
  };
  return { run, calls };
}

it("distinguishes healthy sleep from startup, failed backend and missing listener", () => {
  expect(httpServiceStatus(unit, model()).state).toBe("idle");
  expect(httpServiceStatus(unit, model({ ActiveState: "active" })).state).toBe(
    "running",
  );
  const starting = httpServiceStatus(
    unit,
    model({ ActiveState: "activating" }),
  );
  expect(starting.state).toBe("starting");
  expect(starting.operational).toBe(false);
  expect(starting.active).toBe(true);
  for (const service of [
    { ActiveState: "failed", Result: "exit-code" },
    { LoadState: "not-found" },
    { ActiveState: "activating", Result: "start-limit-hit" },
  ])
    expect(httpServiceStatus(unit, model(service)).operational).toBe(false);
  expect(
    httpServiceStatus(unit, model({}, { ActiveState: "failed" })).operational,
  ).toBe(false);
  expect(
    httpServiceStatus(
      unit,
      model({ ActiveState: "active" }, { ActiveState: "inactive" }),
    ).operational,
  ).toBe(false);
  expect(
    httpServiceStatus(
      unit,
      model(
        { ActiveState: "active" },
        { ActiveState: "inactive", UnitFileState: "disabled" },
      ),
    ).operational,
  ).toBe(true);
});

it("stops a listener before its writer and resumes only the listener", () => {
  const m = model();
  controlService("stop", unit, { ...m, enabled: true });
  expect(m.calls.filter((x) => x[0] === "stop")).toEqual([
    ["stop", socket],
    ["stop", unit],
  ]);
  controlService("start", unit, { ...m, enabled: true });
  expect(m.calls.filter((x) => x[0] === "start")).toEqual([["start", socket]]);
  controlService("enable", unit, { ...m, enabled: true });
  expect(m.calls).toContainEqual(["disable", unit]);
  expect(m.calls).toContainEqual(["enable", socket]);
  const count = m.calls.length;
  controlService("try-restart", unit, { ...m, enabled: true });
  expect(m.calls.slice(count).every((x) => x[0] === "show")).toBe(true);
});

it("fails closed without a socket and preserves ordinary legacy startup", () => {
  const absent = model(
    {},
    {
      LoadState: "not-found",
      ActiveState: "inactive",
      UnitFileState: "disabled",
    },
  );
  expect(() =>
    controlService("start", unit, { ...absent, enabled: true }),
  ).toThrow(/not installed/);
  controlService("start", unit, { ...absent, enabled: false });
  expect(absent.calls).toContainEqual(["start", unit]);
});

it("preserves the installed historical Web role and stops both possible listeners", () => {
  const calls: string[][] = [],
    legacy = "latex-renderer-admin-web.service";
  const run = (...args: string[]) => {
    calls.push(args);
    if (args[0] !== "show") return "";
    const name = args.at(-1),
      historical = name?.includes("admin-web"),
      socket = name?.endsWith(".socket");
    return `LoadState=loaded\nActiveState=${historical && socket ? "active" : "inactive"}\nSubState=${socket ? "listening" : "dead"}\nResult=success\nUnitFileState=${historical && socket ? "enabled" : "disabled"}\n`;
  };
  expect(httpServiceStatus("latex-renderer-web.service", { run }).service).toBe(
    legacy,
  );
  expect(httpServiceStatus("latex-renderer-web.service", { run }).state).toBe(
    "idle",
  );
  controlService("start", "latex-renderer-web.service", { run, enabled: true });
  expect(calls).toContainEqual(["start", "latex-renderer-admin-web.socket"]);
  controlService("stop", "latex-renderer-web.service", { run, enabled: true });
  expect(calls.filter((call) => call[0] === "stop")).toEqual([
    ["stop", "latex-renderer-web.socket"],
    ["stop", "latex-renderer-admin-web.socket"],
    ["stop", "latex-renderer-web.service"],
    ["stop", legacy],
  ]);
});

it("prepares matching service definitions and releases sockets for legacy rollback", () => {
  const directory = mkdtempSync(join(tmpdir(), "http-mode-"));
  try {
    const current = join(directory, "new"),
      legacy = join(directory, "old"),
      units = join(directory, "units");
    for (const root of [current, legacy])
      mkdirSync(join(root, "deploy/systemd"), { recursive: true });
    mkdirSync(join(current, "deploy/scripts"));
    mkdirSync(units);
    writeFileSync(
      join(current, "deploy/scripts/http-idle-server.mjs"),
      "// marker\n",
    );
    const gateway = "latex-renderer-standalone-gateway.service";
    for (const root of [current, legacy]) {
      writeFileSync(
        join(root, "deploy/systemd", gateway),
        "[Unit]\nRequires=latex-renderer-internal-api.service\n",
      );
      writeFileSync(
        join(root, "deploy/systemd", unit),
        `[Service]\nType=${root === current ? "notify" : "simple"}\n`,
      );
    }
    expect(
      prepareHttpActivation(legacy, {
        ...model({}, { LoadState: "not-found" }),
        unitRoot: units,
        values: {},
      }).enabled,
    ).toBe(false);
    for (const name of [gateway, unit])
      writeFileSync(join(units, name), "previous\n");
    const m = model();
    expect(
      prepareHttpActivation(current, { ...m, unitRoot: units, values: {} })
        .enabled,
    ).toBe(true);
    expect(readFileSync(join(units, gateway), "utf8")).toContain(
      "internal-api.socket",
    );
    expect(readFileSync(join(units, unit), "utf8")).toContain("Type=notify");
    expect(
      prepareHttpActivation(legacy, { ...m, unitRoot: units, values: {} })
        .enabled,
    ).toBe(false);
    expect(readFileSync(join(units, gateway), "utf8")).toContain(
      "internal-api.service",
    );
    expect(readFileSync(join(units, unit), "utf8")).toContain("Type=simple");
    expect(m.calls).toContainEqual(["enable", unit]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("disables a compatibility socket without disabling an absent legacy service on fresh hosts", () => {
  const source = join(process.cwd());
  const calls: string[][] = [];
  const run = (...args: string[]) => {
    calls.push(args);
    const name = args.at(-1) ?? "";
    if (args[0] === "show")
      return `LoadState=${name.endsWith("admin-web.service") ? "not-found" : "loaded"}\nActiveState=inactive\n`;
    if (args[0] === "disable" && name.endsWith("admin-web.service"))
      throw new Error("Unit does not exist");
    return "disabled\n";
  };
  const directory = mkdtempSync(join(tmpdir(), "fresh-http-"));
  try {
    prepareHttpActivation(source, { run, unitRoot: directory, values: {} });
    expect(calls).toContainEqual([
      "disable",
      "latex-renderer-admin-web.socket",
    ]);
    expect(calls).not.toContainEqual([
      "disable",
      "latex-renderer-admin-web.service",
    ]);
    expect(calls).toContainEqual(["disable", "latex-renderer-web.service"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("keeps supported passive health available through settings preparation and closes it for legacy targets", () => {
  const directory = mkdtempSync(join(tmpdir(), "passive-preparation-"));
  try {
    const current = join(directory, "current"),
      legacy = join(directory, "legacy"),
      units = join(directory, "units");
    for (const path of [current, legacy])
      mkdirSync(join(path, "deploy/scripts"), { recursive: true });
    mkdirSync(units);
    writeFileSync(
      join(current, "deploy/scripts/passive-health.py"),
      "# supported\n",
    );
    let listening = true;
    const run = (...args: string[]) => {
      if (args[0] === "show")
        return args.at(-1) === "latex-renderer-status.socket"
          ? `LoadState=loaded\nActiveState=${listening ? "active" : "inactive"}\n`
          : "LoadState=not-found\n";
      if (args[0] === "stop" && args.at(-1) === "latex-renderer-status.socket")
        listening = false;
      return "";
    };
    prepareHttpActivation(current, { run, unitRoot: units, values: {} });
    expect(listening).toBe(true);
    prepareHttpActivation(legacy, { run, unitRoot: units, values: {} });
    expect(listening).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it.each([
  ["image-manager", "listening"],
  ["image-manager", "running"],
  ["update-manager", "listening"],
  ["update-manager", "running"],
])(
  "keeps %s usable with a %s listener throughout host/settings preparation",
  (manager, substate) => {
    const directory = mkdtempSync(join(tmpdir(), "updater-self-update-"));
    const service = `latex-renderer-${manager}.service`;
    const listener = `latex-renderer-${manager}.socket`;
    try {
      const source = join(directory, "source"),
        units = join(directory, "units");
      mkdirSync(join(source, "deploy/scripts"), { recursive: true });
      mkdirSync(join(source, "deploy/systemd"), { recursive: true });
      mkdirSync(units);
      for (const marker of ["http-idle-server.mjs", "updater-socket-v1.mjs"])
        writeFileSync(join(source, "deploy/scripts", marker), "// supported\n");
      writeFileSync(join(source, "deploy/systemd", listener), "[Socket]\n");
      writeFileSync(
        join(source, "deploy/systemd", service),
        "[Service]\nType=simple\n",
      );
      writeFileSync(join(units, service), "[Service]\nType=simple\n");
      for (const mode of ["compact", "classic"]) {
        let listening = true;
        const calls: string[][] = [];
        const run = (...args: string[]) => {
          calls.push(args);
          const name = args.at(-1);
          if (args[0] === "show") {
            if (name === listener)
              return `LoadState=loaded\nActiveState=${listening ? "active" : "inactive"}\nSubState=${listening ? substate : "dead"}\nUnitFileState=enabled\n`;
            if (name === service)
              return "LoadState=loaded\nActiveState=active\nResult=success\n";
            return "LoadState=not-found\nActiveState=inactive\n";
          }
          if (args[0] === "is-enabled") return "enabled\n";
          if (name === listener && args[0] === "stop") listening = false;
          if (name === listener && args[0] === "start" && !listening)
            throw new Error("Socket service already active, refusing");
          return "";
        };
        prepareHttpActivation(source, {
          run,
          unitRoot: units,
          validateCompact: () => {},
          values: { RENDERER_RUNTIME_MODE: mode, WORKER_IDLE_ENABLED: "true" },
        });
        if (mode === "compact") {
          expect(() =>
            controlService("start", service, { run, enabled: true }),
          ).not.toThrow();
          expect(listening).toBe(true);
          expect(calls).not.toContainEqual(["stop", listener]);
          expect(calls).not.toContainEqual(["stop", service]);
        } else {
          expect(calls).toContainEqual(["stop", listener]);
          expect(calls).toContainEqual(["disable", listener]);
        }
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it("keeps a published helper's live inherited controller until the independent cutover", () => {
  const directory = mkdtempSync(join(tmpdir(), "updater-legacy-handoff-"));
  try {
    mkdirSync(join(directory, "deploy/scripts"), { recursive: true });
    mkdirSync(join(directory, "deploy/systemd"), { recursive: true });
    writeFileSync(
      join(directory, "deploy/systemd/latex-renderer-update-manager.socket"),
      "[Socket]\n",
    );
    writeFileSync(
      join(directory, "deploy/scripts/updater-socket-v1.mjs"),
      "// supported\n",
    );
    let pid = "123",
      listener = "inactive",
      state = "active";
    const calls: string[][] = [];
    const run = (...args: string[]) => {
      calls.push(args);
      if (args[0] === "show")
        return args.at(-1)?.endsWith(".socket")
          ? `LoadState=loaded\nActiveState=${listener}\nSubState=dead\nUnitFileState=enabled\n`
          : `LoadState=loaded\nActiveState=${state}\nResult=success\nMainPID=${pid}\n`;
      if (args[0] === "start" && listener === "inactive")
        throw new Error("Socket service already active, refusing");
      return "";
    };
    const options = {
      run,
      source: directory,
      values: { RENDERER_RUNTIME_MODE: "compact", WORKER_IDLE_ENABLED: "true" },
      parentMutationLock: "application-update",
    };
    expect(deploymentUpdater("start", "", options)).toBe("123");
    expect(deploymentUpdater("ready", "123", options)).toBe("123");
    expect(calls.every((call) => call[0] === "show")).toBe(true);
    expect(() =>
      deploymentUpdater("ready", "123", { ...options, parentMutationLock: "" }),
    ).toThrow(/changed/);
    expect(() =>
      deploymentUpdater("ready", "123", {
        ...options,
        values: { RENDERER_RUNTIME_MODE: "classic" },
      }),
    ).toThrow(/changed/);
    pid = "124";
    expect(() => deploymentUpdater("ready", "123", options)).toThrow(/changed/);
    pid = "123";
    state = "failed";
    expect(() => deploymentUpdater("ready", "123", options)).toThrow(/changed/);
    state = "active";
    listener = "failed";
    expect(() => deploymentUpdater("ready", "123", options)).toThrow(/changed/);
    listener = "inactive";
    expect(() => deploymentUpdater("ready", "", options)).toThrow(/not ready/);
    expect(() =>
      deploymentUpdater("start", "", { ...options, parentMutationLock: "" }),
    ).toThrow(/refusing/);
    listener = "active";
    expect(deploymentUpdater("start", "", options)).toBe("");
    expect(deploymentUpdater("ready", "", options)).toBe("");
    expect(calls).toContainEqual([
      "start",
      "latex-renderer-update-manager.socket",
    ]);
    expect(() => deploymentUpdater("ready", "../123", options)).toThrow(
      /Invalid/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
