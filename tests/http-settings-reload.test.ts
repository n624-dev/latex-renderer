import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  HTTP_SERVICE_UNITS,
  httpSocketUnit,
  reconcileHttpServices,
} from "../deploy/scripts/http-services.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "http-reload-"));
  const source = join(root, "source"),
    unitRoot = join(root, "units");
  mkdirSync(join(source, "deploy/scripts"), { recursive: true });
  mkdirSync(join(source, "deploy/systemd"));
  mkdirSync(unitRoot);
  writeFileSync(
    join(source, "deploy/scripts/http-idle-server.mjs"),
    "// activation marker",
  );
  const gateway = "latex-renderer-standalone-gateway.service";
  for (const name of [...HTTP_SERVICE_UNITS, gateway]) {
    const text = `[Unit]\nRequires=latex-renderer-internal-api.service\n[Service]\nType=notify\n`;
    writeFileSync(join(source, "deploy/systemd", name), text);
    writeFileSync(join(unitRoot, name), text);
  }
  const states = new Map<
    string,
    { active: boolean; enabled: boolean; socket: boolean }
  >();
  for (const service of HTTP_SERVICE_UNITS) {
    states.set(service, { active: false, enabled: false, socket: false });
    const selected = !service.includes("admin-web");
    states.set(httpSocketUnit(service) as string, {
      active: selected,
      enabled: selected,
      socket: true,
    });
  }
  states.set(gateway, { active: true, enabled: true, socket: false });
  let locked = false,
    released = 0,
    failNextStart = false,
    interruptPreparation = false;
  const calls: string[][] = [];
  const run = (...args: string[]) => {
    expect(locked).toBe(true);
    calls.push(args);
    const name = args.at(-1) ?? "",
      state = states.get(name);
    if (args[0] === "show")
      return state
        ? `LoadState=loaded\nActiveState=${state.active ? "active" : "inactive"}\nSubState=${state.active && state.socket ? "listening" : "dead"}\nUnitFileState=${state.enabled ? "enabled" : "disabled"}\nResult=success\n`
        : "LoadState=not-found\nActiveState=inactive\n";
    if (args[0] === "is-enabled") {
      if (!state?.enabled)
        throw Object.assign(new Error("disabled"), { status: 1 });
      return "enabled\n";
    }
    if (args[0] === "daemon-reload") {
      if (interruptPreparation) {
        interruptPreparation = false;
        throw new Error("interrupted preparation");
      }
      return "";
    }
    if (!state) throw new Error("Unmanaged service operation");
    if (args[0] === "stop") state.active = false;
    if (args[0] === "start") {
      if (failNextStart && name === "latex-renderer-api.service") {
        failNextStart = false;
        throw new Error("fixture start failure");
      }
      state.active = true;
    }
    if (args[0] === "enable") state.enabled = true;
    if (args[0] === "disable") state.enabled = false;
    return "";
  };
  const acquire = () => {
    expect(locked).toBe(false);
    locked = true;
    return Promise.resolve({
      release: () => {
        locked = false;
        released++;
        return Promise.resolve();
      },
    });
  };
  return {
    root,
    source,
    unitRoot,
    states,
    calls,
    run,
    acquire,
    released: () => released,
    fail: () => {
      failNextStart = true;
    },
    interrupt: () => {
      interruptPreparation = true;
    },
  };
}

it.skipIf(process.platform === "win32")(
  "applies environment-only disable/enable, boot links and gateway dependencies under the mutation lock",
  async () => {
    const f = fixture();
    try {
      for (const enabled of [false, true, true]) {
        expect(
          await reconcileHttpServices({
            ...f,
            values: { HTTP_IDLE_ENABLED: String(enabled) },
          }),
        ).toEqual({ enabled });
        for (const [name, state] of f.states) {
          if (name.includes("admin-web") || name.includes("standalone"))
            continue;
          expect(state.enabled).toBe(state.socket === enabled);
          expect(state.active).toBe(state.socket === enabled);
        }
        expect(
          f.states.get("latex-renderer-standalone-gateway.service")?.active,
        ).toBe(true);
        expect(
          readFileSync(
            join(f.unitRoot, "latex-renderer-standalone-gateway.service"),
            "utf8",
          ),
        ).toContain(`internal-api.${enabled ? "socket" : "service"}`);
      }
      expect(f.released()).toBe(3);
      expect(
        f.calls
          .flat()
          .some((value) => /worker|image-manager|update-manager/.test(value)),
      ).toBe(false);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform === "win32")(
  "keeps a boot path through interrupted mode changes and resumes on retry",
  async () => {
    const f = fixture();
    try {
      for (const enabled of [false, true]) {
        f.interrupt();
        await expect(
          reconcileHttpServices({
            ...f,
            values: { HTTP_IDLE_ENABLED: String(enabled) },
          }),
        ).rejects.toThrow("interrupted preparation");
        for (const service of HTTP_SERVICE_UNITS.filter(
          (name) => !name.includes("admin-web"),
        ))
          expect(
            f.states.get(service)?.enabled ||
              f.states.get(httpSocketUnit(service) as string)?.enabled,
          ).toBe(true);
        await expect(
          reconcileHttpServices({
            ...f,
            values: { HTTP_IDLE_ENABLED: String(enabled) },
          }),
        ).resolves.toEqual({ enabled });
      }
      expect(f.released()).toBe(4);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform === "win32")(
  "validates before stopping and makes a failed resume retryable without touching user data",
  async () => {
    const f = fixture();
    try {
      await expect(
        reconcileHttpServices({
          ...f,
          values: { HTTP_IDLE_TIMEOUT_SECONDS: "0" },
        }),
      ).rejects.toThrow();
      expect(f.calls).toEqual([]);
      expect(f.released()).toBe(1);
      f.fail();
      await expect(
        reconcileHttpServices({ ...f, values: { HTTP_IDLE_ENABLED: "false" } }),
      ).rejects.toThrow(/resume/);
      expect(f.released()).toBe(2);
      await expect(
        reconcileHttpServices({ ...f, values: { HTTP_IDLE_ENABLED: "false" } }),
      ).resolves.toEqual({ enabled: false });
      const count = f.calls.length;
      await expect(
        reconcileHttpServices({
          ...f,
          acquire: () => Promise.reject(new Error("MUTATION_LOCK_BUSY")),
        }),
      ).rejects.toThrow("MUTATION_LOCK_BUSY");
      expect(f.calls.length).toBe(count);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  },
);
