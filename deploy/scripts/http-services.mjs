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
import { acquireMutationLock } from "./mutation-lock.mjs";
import { workerIdleConfiguration } from "./worker-demand.mjs";
import { runtimeMode } from "./runtime-mode.mjs";
import { workerEngineCommand } from "./on-demand-engine.mjs";

export const HTTP_SERVICE_PORTS = Object.freeze({
  "latex-renderer-api.service": 3100,
  "latex-renderer-web.service": 3101,
  "latex-renderer-admin-web.service": 3101,
  "latex-renderer-admin-api.service": 3102,
  "latex-renderer-internal-api.service": 3103,
  "latex-renderer-remote-mcp.service": 3104,
  "latex-renderer-standalone-gateway.service": 3105,
});
export const HTTP_SERVICE_UNITS = Object.freeze(
  Object.keys(HTTP_SERVICE_PORTS),
);
const root = "/opt/latex-renderer/current";
const managerUnits = [
  "latex-renderer-image-manager.service",
  "latex-renderer-update-manager.service",
];
const systemctl = (...args) =>
  execFileSync("/usr/bin/systemctl", args, {
    encoding: "utf8",
    timeout: args[0] === "show" ? 5000 : 15 * 60_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
export function httpSocketUnit(unit) {
  return Object.hasOwn(HTTP_SERVICE_PORTS, unit) ||
    unit === "latex-renderer-worker.service" ||
    managerUnits.includes(unit)
    ? unit.replace(/\.service$/, ".socket")
    : undefined;
}
function properties(unit, run) {
  const text = run(
    "show",
    "--no-pager",
    "--property=LoadState,ActiveState,SubState,Result,UnitFileState,MainPID",
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
    const match =
      /^(HTTP_IDLE_ENABLED|HTTP_IDLE_TIMEOUT_SECONDS|WORKER_IDLE_ENABLED|WORKER_IDLE_TIMEOUT_SECONDS|RENDERER_RUNTIME_MODE|MANAGER_IDLE_TIMEOUT_SECONDS)=(.*)$/.exec(
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
export function supportsWorkerActivation(source = root) {
  return existsSync(join(source, "deploy/scripts/worker-demand.mjs"));
}
export function workerActivationEnabled({ source = root, values } = {}) {
  return (
    supportsWorkerActivation(source) &&
    workerIdleConfiguration(
      values ?? environment("/etc/latex-renderer/renderer.env"),
    ).enabled
  );
}
export function httpActivationEnabled({ source = root, values } = {}) {
  return (
    supportsHttpActivation(source) &&
    httpIdleConfiguration(
      values ?? environment("/etc/latex-renderer/renderer.env"),
    ).enabled
  );
}
function activationEnabledFor(unit, options = {}) {
  if (unit === "latex-renderer-worker.service")
    return workerActivationEnabled(options);
  const source = options.source ?? root;
  if (managerUnits.includes(unit))
    return (
      existsSync(join(source, "deploy/systemd", httpSocketUnit(unit))) &&
      runtimeMode(
        options.values ?? environment("/etc/latex-renderer/renderer.env"),
      ) === "compact"
    );
  if (
    unit === "latex-renderer-standalone-gateway.service" &&
    !existsSync(
      join(source, "deploy/systemd/latex-renderer-standalone-gateway.socket"),
    )
  )
    return false;
  return httpActivationEnabled(options);
}

// Logical service operations include the listener. In particular a stopped
// writer cannot be restarted by a new request during configuration/DB cutover.
export function controlService(
  action,
  unit,
  { run = systemctl, enabled = activationEnabledFor(unit) } = {},
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
  {
    run = systemctl,
    unitRoot = "/etc/systemd/system",
    values,
    validateCompact = () =>
      execFileSync(
        "/usr/local/bin/node",
        [join(source, "deploy/scripts/updater-transport.mjs"), "check"],
        { timeout: 30000, stdio: ["ignore", "pipe", "pipe"] },
      ),
  } = {},
) {
  if (!isAbsolute(source))
    throw new Error("HTTP activation source must be absolute");
  const enabled = httpActivationEnabled({ source, values });
  const workerEnabled = workerActivationEnabled({ source, values });
  const compact =
    existsSync(join(source, "deploy/scripts/updater-socket-v1.mjs")) &&
    runtimeMode(values ?? environment("/etc/latex-renderer/renderer.env")) ===
      "compact";
  if (compact) validateCompact();
  const passive = existsSync(join(source, "deploy/scripts/passive-health.py"));
  if (properties("latex-renderer-status.socket", run).LoadState === "loaded") {
    run("stop", "latex-renderer-status.socket");
    run(passive ? "enable" : "disable", "latex-renderer-status.socket");
  }
  if (
    !compact &&
    properties("latex-renderer-engine-idle.timer", run).LoadState === "loaded"
  )
    run("disable", "--now", "latex-renderer-engine-idle.timer");
  if (
    !workerEnabled &&
    properties("latex-renderer-worker-reconcile.timer", run).LoadState ===
      "loaded"
  )
    run("disable", "--now", "latex-renderer-worker-reconcile.timer");
  for (const unit of [
    ...HTTP_SERVICE_UNITS,
    "latex-renderer-worker.service",
    ...managerUnits,
  ]) {
    const socket = httpSocketUnit(unit);
    if (properties(socket, run).LoadState !== "loaded") continue;
    let wasEnabled = false;
    try {
      wasEnabled = run("is-enabled", socket).trim() === "enabled";
    } catch {
      /* disabled */
    }
    // Compact backends depend on these listeners. Closing one while its Manager
    // is serving the inherited FD makes systemd refuse to reopen it, so even an
    // unrelated settings cutover cannot restart dependent backends. Preserve
    // compatible Manager supervision until an explicit restart/cutover owns it.
    const preserveManager =
      compact &&
      managerUnits.includes(unit) &&
      activationEnabledFor(unit, { source, values }) &&
      properties(socket, run).ActiveState === "active" &&
      ["listening", "running"].includes(properties(socket, run).SubState);
    if (!preserveManager) run("stop", socket);
    if (activationEnabledFor(unit, { source, values })) run("disable", unit);
    else {
      run("disable", socket);
      if (wasEnabled) run("enable", unit);
    }
  }
  for (const filename of new Set([
    ...HTTP_SERVICE_UNITS,
    "latex-renderer-worker.service",
    ...managerUnits,
    "latex-renderer-updater-activate.service",
    "latex-renderer-image-refresh.service",
    "latex-renderer-update-refresh.service",
    "latex-renderer-standalone-gateway.service",
  ])) {
    const sourceUnit = join(source, "deploy/systemd", filename);
    if (!existsSync(sourceUnit)) continue;
    const path = join(unitRoot, filename);
    let info;
    try {
      info = lstatSync(path);
    } catch (error) {
      // A first installation of a pre-activation baseline has no managed
      // service definitions yet. Its own host preparation installs them.
      if (error.code === "ENOENT") continue;
      throw error;
    }
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
    if (compact && !managerUnits.includes(filename))
      text = text.replaceAll(
        "latex-renderer-image-manager.service",
        "latex-renderer-image-manager.socket",
      );
    if (compact && filename === "latex-renderer-worker.service")
      text = text
        .replaceAll(
          "latex-renderer-image-manager.service",
          "latex-renderer-image-manager.socket",
        )
        .replace(/^PartOf=.*\n/gm, "");
    if (compact && filename === "latex-renderer-image-manager.service")
      text = text.replace(/^ExecStartPre=.*\n/gm, "");
    if (
      compact &&
      [
        "latex-renderer-image-refresh.service",
        "latex-renderer-update-refresh.service",
      ].includes(filename)
    )
      for (const manager of managerUnits)
        text = text.replaceAll(manager, httpSocketUnit(manager));
    const temporary = `${path}.http-${process.pid}`;
    writeFileSync(temporary, text, { mode: 0o644, flag: "wx" });
    renameSync(temporary, path);
  }
  run("daemon-reload");
  return { enabled };
}

// Published compact helpers can close the systemd listener before invoking
// this release. Its inherited FD and pathname remain served by the controller.
// Reopening the systemd socket is impossible until that controller stops. Keep
// its PID alive until it commits the operation; independent activation restores
// socket supervision and health-checks the selected slot after that boundary.
export function deploymentUpdater(
  action,
  expectedPid = "",
  {
    run = systemctl,
    source = root,
    values,
    parentMutationLock = process.env.LATEX_RENDERER_PARENT_MUTATION_LOCK,
  } = {},
) {
  const unit = "latex-renderer-update-manager.service";
  if (
    !["start", "ready"].includes(action) ||
    (expectedPid !== "" && !/^[1-9]\d*$/.test(expectedPid))
  )
    throw new Error("Invalid deployment Updater handoff");
  const compact = activationEnabledFor(unit, { source, values });
  const service = properties(unit, run);
  const listener = properties(httpSocketUnit(unit), run);
  const live =
    service.LoadState === "loaded" &&
    service.ActiveState === "active" &&
    service.Result === "success" &&
    /^[1-9]\d*$/.test(service.MainPID ?? "");
  if (expectedPid !== "") {
    if (
      action !== "ready" ||
      parentMutationLock !== "application-update" ||
      !compact ||
      !live ||
      !["active", "inactive"].includes(listener.ActiveState) ||
      service.MainPID !== expectedPid
    )
      throw new Error("Live legacy Updater changed before operation commit");
    return expectedPid;
  }
  if (action === "start") {
    if (
      parentMutationLock === "application-update" &&
      compact &&
      live &&
      listener.LoadState === "loaded" &&
      listener.ActiveState === "inactive"
    )
      return service.MainPID;
    controlService("start", unit, { run, enabled: compact });
  } else if (!httpServiceStatus(unit, { run }).operational)
    throw new Error("Deployment Updater is not ready");
  return "";
}

// Environment-only idle settings are intentionally separate from the wizard's
// auth/runtime review. An unchanged wizard review does not restart consumers.
// This explicit operation takes the same lock as deployment and image changes.
export async function reconcileHttpServices({
  source = root,
  run = systemctl,
  unitRoot = "/etc/systemd/system",
  values,
  acquire = acquireMutationLock,
  configureEngine = (compact) => {
    workerEngineCommand("/usr/bin/systemctl", [
      "--user",
      compact ? "disable" : "enable",
      "docker.service",
    ]);
    workerEngineCommand("/usr/bin/systemctl", [
      "--user",
      "start",
      "docker.service",
    ]);
  },
} = {}) {
  const lock = await acquire();
  try {
    const enabled = httpActivationEnabled({ source, values });
    const compactCapable = existsSync(
      join(source, "deploy/scripts/updater-socket-v1.mjs"),
    );
    const compact =
      compactCapable &&
      runtimeMode(values ?? environment("/etc/latex-renderer/renderer.env")) ===
        "compact";
    if (compact)
      execFileSync(
        "/usr/local/bin/node",
        [join(source, "deploy/scripts/updater-transport.mjs"), "check"],
        { timeout: 30000, stdio: ["ignore", "pipe", "pipe"] },
      );
    const names = ["api", "web", "admin-api", "internal-api", "remote-mcp"];
    if (
      supportsWorkerActivation(source) &&
      properties("latex-renderer-worker.service", run).LoadState === "loaded"
    )
      names.push("worker");
    for (const unit of managerUnits)
      if (
        existsSync(join(source, "deploy/systemd", httpSocketUnit(unit))) &&
        properties(unit, run).LoadState === "loaded"
      )
        names.push(unit.slice("latex-renderer-".length, -".service".length));
    const units = names.map((name) => {
      const entry = httpServiceStatus(`latex-renderer-${name}.service`, {
        run,
      });
      return {
        ...entry,
        enabled: activationEnabledFor(entry.service, { source, values }),
        listener: properties(httpSocketUnit(entry.service), run),
      };
    });
    if (units.some((entry) => !entry.managed))
      throw new Error("Managed HTTP service definitions required");
    if (
      units.some(
        (entry) => entry.enabled && entry.listener.LoadState !== "loaded",
      )
    )
      throw new Error(
        "HTTP activation sockets must be installed before reconciliation",
      );
    const gateway = "latex-renderer-standalone-gateway.service";
    const gatewayActive = httpServiceStatus(gateway, { run }).active;
    const gatewayEnabled = activationEnabledFor(gateway, { source, values });
    let stopping = false,
      prepared = false;
    try {
      // Stop listeners first, so quiescing one backend cannot wake another.
      stopping = true;
      for (const { service } of units) {
        const socket = httpSocketUnit(service);
        if (properties(socket, run).LoadState === "loaded") run("stop", socket);
      }
      for (const { service, enabled } of units)
        controlService("stop", service, { run, enabled });
      // Install the new boot link before preparation removes the previous
      // mode's link. A crash can leave both enabled temporarily, but never
      // deliberately leaves a previously managed role without a boot path.
      // Current entrypoints support both inherited and ordinary listeners.
      for (const { service, enabled } of units)
        run("enable", enabled ? httpSocketUnit(service) : service);
      prepareHttpActivation(source, { run, unitRoot, values });
      prepared = true;
      if (compactCapable) configureEngine(compact);
      const failures = [];
      for (const { service, enabled } of units) {
        try {
          controlService("enable", service, { run, enabled });
          controlService("start", service, { run, enabled });
        } catch {
          failures.push(service);
        }
      }
      const worker = units.find(
        (entry) => entry.service === "latex-renderer-worker.service",
      );
      if (worker?.enabled)
        run("enable", "--now", "latex-renderer-worker-reconcile.timer");
      if (compact) run("enable", "--now", "latex-renderer-engine-idle.timer");
      if (existsSync(join(source, "deploy/scripts/passive-health.py")))
        run("start", "latex-renderer-status.socket");
      if (gatewayActive) {
        try {
          controlService("enable", gateway, { run, enabled: gatewayEnabled });
          controlService("start", gateway, { run, enabled: gatewayEnabled });
        } catch {
          failures.push(gateway);
        }
      }
      if (failures.length)
        throw new Error(
          "HTTP settings reconciliation could not resume every consumer",
        );
      return { enabled };
    } catch (error) {
      // No database or user data is changed. Resume every previously active
      // role where possible; a retry reconciles partially changed boot links.
      if (stopping) {
        for (const { service, active, listener, enabled } of units)
          if (active) {
            try {
              // Until daemon-reload completes, the gateway's live dependency
              // still expects the original listener mode. Current entrypoints
              // support either mode even when the env has already changed.
              controlService("start", service, {
                run,
                enabled: prepared ? enabled : listener.ActiveState === "active",
              });
            } catch {
              /* retain primary failure */
            }
          }
        if (gatewayActive)
          try {
            controlService("start", gateway, { run, enabled: gatewayEnabled });
          } catch {
            /* retain primary failure */
          }
      }
      throw error;
    }
  } finally {
    await lock.release();
  }
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
  if (action === "reconcile" && args.length === 0) {
    console.log(JSON.stringify(await reconcileHttpServices()));
    return;
  }
  if (action === "prepare" && args.length === 1) {
    console.log(JSON.stringify(prepareHttpActivation(args[0])));
    return;
  }
  if (action === "deployment-updater" && args.length >= 1 && args.length <= 2) {
    console.log(deploymentUpdater(args[0], args[1] ?? ""));
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
