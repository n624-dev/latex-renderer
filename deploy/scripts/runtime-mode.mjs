import { boundedIntegerEnvironment } from "./environment.mjs";
import { readFileSync } from "node:fs";
import { isMainModule } from "./is-main-module.mjs";
export function runtimeEnvironment(contents) {
  if (/[\0\r]/.test(contents)) throw new Error("Invalid runtime environment");
  const values = {};
  for (const line of contents.split("\n")) {
    const match =
      /^(RENDERER_RUNTIME_MODE|HTTP_IDLE_ENABLED|HTTP_IDLE_TIMEOUT_SECONDS|WORKER_IDLE_ENABLED|WORKER_IDLE_TIMEOUT_SECONDS|MANAGER_IDLE_TIMEOUT_SECONDS|ALLOW_ROOTFUL_DOCKER|DOCKER_HOST)=(.*)$/.exec(
        line,
      );
    if (!match) continue;
    if (Object.hasOwn(values, match[1]))
      throw new Error("Duplicate runtime setting");
    const raw = match[2];
    values[match[1]] = /^(["']).*\1$/.test(raw) ? raw.slice(1, -1) : raw;
  }
  return values;
}

export function runtimeMode(environment = process.env) {
  const mode = environment.RENDERER_RUNTIME_MODE ?? "classic";
  if (!["classic", "compact"].includes(mode))
    throw new Error("RENDERER_RUNTIME_MODE must be classic or compact");
  if (
    mode === "compact" &&
    (environment.HTTP_IDLE_ENABLED === "false" ||
      environment.WORKER_IDLE_ENABLED !== "true")
  )
    throw new Error("Compact mode requires HTTP and Worker activation");
  if (mode === "compact" && environment.ALLOW_ROOTFUL_DOCKER === "true")
    throw new Error("Compact mode requires the dedicated rootless engine");
  return mode;
}
if (isMainModule(import.meta.url)) {
  if (process.argv.length !== 2)
    throw new Error("Runtime mode accepts no arguments");
  console.log(
    runtimeMode(
      runtimeEnvironment(
        readFileSync("/etc/latex-renderer/renderer.env", "utf8"),
      ),
    ),
  );
}
export function managerIdleConfiguration(environment = process.env) {
  return {
    enabled: runtimeMode(environment) === "compact",
    timeoutMs:
      1000 *
      boundedIntegerEnvironment(
        environment,
        "MANAGER_IDLE_TIMEOUT_SECONDS",
        900,
        30,
        86400,
      ),
  };
}
