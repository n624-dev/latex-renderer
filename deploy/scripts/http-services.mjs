import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  lstatSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { join, isAbsolute } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { httpIdleConfiguration } from "./http-idle-server.mjs";
import { isMainModule } from "./is-main-module.mjs";

export const HTTP_SERVICE_PORTS = Object.freeze({
  "latex-renderer-api.service": 3100,
  "latex-renderer-web.service": 3101,
  "latex-renderer-admin-web.service": 3101,
  "latex-renderer-admin-api.service": 3102,
  "latex-renderer-internal-api.service": 3103,
  "latex-renderer-remote-mcp.service": 3104,
});
export const HTTP_SERVICE_UNITS = Object.freeze(
  Object.keys(HTTP_SERVICE_PORTS),
);
const root = "/opt/latex-renderer/current";
const systemctl = (...args) =>
  execFileSync("/usr/bin/systemctl", args, {
    encoding: "utf8",
    timeout: 15 * 60_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
export function httpSocketUnit(unit) {
  return Object.hasOwn(HTTP_SERVICE_PORTS, unit)
    ? unit.replace(/\.service$/, ".socket")
    : undefined;
}
function properties(unit, run) {
  const text = run(
    "show",
    "--no-pager",
    "--property=LoadState,ActiveState,SubState,Result,UnitFileState",
    unit,
  );
  return Object.fromEntries(
    text
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
}
function selectedUnit(unit, run) {
  if (unit !== "latex-renderer-web.service") return unit;
  const preferred = [unit, httpSocketUnit(unit)].map((name) =>
    properties(name, run),
  );
  if (
    preferred.some(
      (value) =>
        value.UnitFileState === "enabled" || value.ActiveState === "active",
    )
  )
    return unit;
  const legacy = [
    "latex-renderer-admin-web.service",
    "latex-renderer-admin-web.socket",
  ].map((name) => properties(name, run));
  return legacy.some(
    (value) =>
      value.UnitFileState === "enabled" || value.ActiveState === "active",
  )
    ? "latex-renderer-admin-web.service"
    : unit;
}
export function httpServiceStatus(
  unit,
  { run = systemctl, aliases = true } = {},
) {
  if (aliases) unit = selectedUnit(unit, run);
  const socket = httpSocketUnit(unit);
  if (!socket) throw new Error("Unknown HTTP service");
  const service = properties(unit, run),
    listener = properties(socket, run);
  const bad =
    service.LoadState !== "loaded" ||
    service.ActiveState === "failed" ||
    listener.ActiveState === "failed" ||
    (listener.UnitFileState === "enabled" &&
      listener.ActiveState !== "active") ||
    (service.Result !== undefined &&
      service.Result !== "success" &&
      service.Result !== "");
  let state = "unavailable";
  if (!bad && service.ActiveState === "active") state = "running";
  else if (!bad && service.ActiveState === "activating") state = "starting";
  else if (
    !bad &&
    service.ActiveState === "inactive" &&
    listener.ActiveState === "active" &&
    listener.SubState === "listening"
  )
    state = "idle";
  return {
    service: unit,
    state,
    operational: state === "running" || state === "idle",
    managed: service.LoadState === "loaded",
    active: [service, listener].some((value) =>
      ["active", "activating", "deactivating"].includes(value.ActiveState),
    ),
  };
}
export function httpServicesSnapshot() {
  const units = ["api", "internal-api", "admin-api", "remote-mcp", "web"].map(
    (name) => `latex-renderer-${name}.service`,
  );
  if (process.platform !== "linux" || !existsSync("/run/systemd/system"))
    return { managed: false, services: [] };
  try {
    // One read-only systemctl invocation per snapshot, rather than spawning
    // children for each backend and alias on every status-page request.
    const output = systemctl(
      "show",
      "--no-pager",
      "--property=Id,LoadState,ActiveState,SubState,Result,UnitFileState",
      ...HTTP_SERVICE_UNITS,
      ...HTTP_SERVICE_UNITS.map(httpSocketUnit),
    );
    const records = new Map(
      output
        .trim()
        .split(/\n\s*\n/)
        .map((block) => {
          const id = /^Id=(.+)$/m.exec(block)?.[1];
          return [id, block];
        }),
    );
    const run = (...args) => {
      const value = records.get(args.at(-1));
      if (!value) throw new Error("Incomplete HTTP service status");
      return value;
    };
    const services = units.map((unit) => httpServiceStatus(unit, { run }));
    return { managed: services.some((value) => value.managed), services };
  } catch {
    return {
      managed: true,
      services: units.map((service) => ({
        service,
        state: "unavailable",
        operational: false,
        managed: true,
        active: false,
      })),
    };
  }
}
function environment(path) {
  const result = {};
  let contents;
  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return result;
    throw error;
  }
  for (const line of contents.split("\n")) {
    const match = /^(HTTP_IDLE_ENABLED|HTTP_IDLE_TIMEOUT_SECONDS)=(.*)$/.exec(
      line,
    );
    if (!match) continue;
    const [, name, raw] = match;
    if (Object.hasOwn(result, name))
      throw new Error("Duplicate HTTP idle setting");
    result[name] = /^(["']).*\1$/.test(raw) ? raw.slice(1, -1) : raw;
  }
  return result;
}
export function supportsHttpActivation(source = root) {
  return existsSync(join(source, "deploy/scripts/http-idle-server.mjs"));
}
export function httpActivationEnabled({ source = root, values } = {}) {
  return (
    supportsHttpActivation(source) &&
    httpIdleConfiguration(
      values ?? environment("/etc/latex-renderer/renderer.env"),
    ).enabled
  );
}

// Logical service operations include the listener. In particular a stopped
// writer cannot be restarted by a new request during configuration/DB cutover.
export function controlService(
  action,
  unit,
  { run = systemctl, enabled = httpActivationEnabled() } = {},
) {
  if (action === "stop" && unit === "latex-renderer-web.service") {
    for (const name of [unit, "latex-renderer-admin-web.service"]) {
      const listener = httpSocketUnit(name);
      if (properties(listener, run).LoadState === "loaded")
        run("stop", listener);
    }
    for (const name of [unit, "latex-renderer-admin-web.service"])
      if (properties(name, run).LoadState === "loaded") run("stop", name);
    return "";
  }
  if (action !== "stop") unit = selectedUnit(unit, run);
  const socket = httpSocketUnit(unit);
  if (!socket) return run(action, unit);
  const loaded = properties(socket, run).LoadState === "loaded";
  if (action === "stop") {
    if (loaded) run("stop", socket);
    return run("stop", unit);
  }
  if (action === "enable") {
    if (enabled) {
      if (!loaded) throw new Error("HTTP activation socket is not installed");
      run("disable", unit);
      return run("enable", socket);
    }
    if (loaded) run("disable", socket);
    return run("enable", unit);
  }
  if (action === "try-restart") {
    if (!["active", "activating"].includes(properties(unit, run).ActiveState))
      return "";
    action = "restart";
  }
  if (action === "restart") controlService("stop", unit, { run, enabled });
  if (action === "start" || action === "restart") {
    if (enabled) {
      if (!loaded) throw new Error("HTTP activation socket is not installed");
      return run("start", socket);
    }
    if (loaded) run("stop", socket);
    return run("start", unit);
  }
  throw new Error("Unsupported logical HTTP service operation");
}

// Called only inside the existing privileged, quiesced host preparation. An
// older release needs ordinary service boot links and must not inherit a socket
// dependency or a port held by this release's activation units.
export function prepareHttpActivation(
  source,
  { run = systemctl, unitRoot = "/etc/systemd/system", values } = {},
) {
  if (!isAbsolute(source))
    throw new Error("HTTP activation source must be absolute");
  const enabled = httpActivationEnabled({ source, values });
  for (const unit of HTTP_SERVICE_UNITS) {
    const socket = httpSocketUnit(unit);
    if (properties(socket, run).LoadState !== "loaded") continue;
    let wasEnabled = false;
    try {
      wasEnabled = run("is-enabled", socket).trim() === "enabled";
    } catch {
      /* disabled */
    }
    run("stop", socket);
    if (enabled) run("disable", unit);
    else {
      run("disable", socket);
      if (wasEnabled) run("enable", unit);
    }
  }
  for (const filename of [
    ...HTTP_SERVICE_UNITS,
    "latex-renderer-standalone-gateway.service",
  ]) {
    const sourceUnit = join(source, "deploy/systemd", filename);
    if (!existsSync(sourceUnit)) continue;
    const path = join(unitRoot, filename),
      info = lstatSync(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      info.uid !== process.getuid()
    )
      throw new Error("Unsafe managed gateway unit");
    let text = readFileSync(sourceUnit, "utf8");
    if (enabled && filename === "latex-renderer-standalone-gateway.service")
      text = text.replaceAll(
        "latex-renderer-internal-api.service",
        "latex-renderer-internal-api.socket",
      );
    const temporary = `${path}.http-${process.pid}`;
    writeFileSync(temporary, text, { mode: 0o644, flag: "wx" });
    renameSync(temporary, path);
  }
  run("daemon-reload");
  return { enabled };
}

async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (["status", "ready", "active"].includes(action)) {
    if (!args.length || args.some((unit) => !httpSocketUnit(unit)))
      throw new Error("HTTP service names required");
    let results = args.map((unit) => httpServiceStatus(unit));
    const deadline = Date.now() + 30_000;
    while (
      action === "ready" &&
      results.some((result) => result.state === "starting") &&
      Date.now() < deadline
    ) {
      await delay(100);
      results = args.map((unit) => httpServiceStatus(unit));
    }
    if (action === "status") console.log(JSON.stringify({ services: results }));
    if (
      results.some((result) =>
        action === "active" ? !result.active : !result.operational,
      )
    )
      process.exitCode = 1;
    return;
  }
  if (process.getuid() !== 0)
    throw new Error("Privileged HTTP service operation required");
  if (action === "prepare" && args.length === 1) {
    console.log(JSON.stringify(prepareHttpActivation(args[0])));
    return;
  }
  if (
    !["start", "restart", "stop", "enable", "try-restart"].includes(action) ||
    !args.length ||
    args.some((unit) => !httpSocketUnit(unit))
  )
    throw new Error("Invalid HTTP service operation");
  // Stop every listener before stopping any writer. Connections cannot wake a
  // different API while another writer is already quiesced.
  if (action === "stop")
    for (const unit of args) {
      const socket = httpSocketUnit(unit);
      if (properties(socket, systemctl).LoadState === "loaded")
        systemctl("stop", socket);
    }
  for (const unit of args) controlService(action, unit);
}
if (isMainModule(import.meta.url)) await main();
