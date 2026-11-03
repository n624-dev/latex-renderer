import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { acquireMutationLock } from "./mutation-lock.mjs";
import { acquireEngineLock, workerEngineCommand } from "./on-demand-engine.mjs";
import { workerHasDemand } from "./worker-demand.mjs";
import { runtimeMode } from "./runtime-mode.mjs";
import { isMainModule } from "./is-main-module.mjs";

export async function idleContainerEngine({
  environment = process.env,
  acquireMutation = acquireMutationLock,
  acquireEngine = () => acquireEngineLock({ exclusive: true }),
  command = workerEngineCommand,
  service = (unit) =>
    execFileSync(
      "/usr/bin/systemctl",
      ["show", "--no-pager", "--property=LoadState,ActiveState,Result", unit],
      { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] },
    ),
} = {}) {
  if (runtimeMode(environment) !== "compact") return { state: "disabled" };
  let mutation, engine;
  try {
    // Never wait on the shared engine lock while owning the mutation lock.
    // Updaters and image operations retain their existing lock ordering.
    mutation = await acquireMutation();
    engine = await acquireEngine();
    for (const name of [
      "worker",
      "image-manager",
      "update-manager",
      "updater-activate",
    ]) {
      const state = service(`latex-renderer-${name}.service`);
      if (
        !/^LoadState=loaded$/m.test(state) ||
        !/^ActiveState=inactive$/m.test(state) ||
        !/^Result=success$/m.test(state)
      )
        return { state: "busy" };
    }
    const database = new DatabaseSync(environment.DATABASE_PATH, {
      readOnly: true,
    });
    try {
      database.exec("PRAGMA busy_timeout=1000");
      if (workerHasDemand(database)) return { state: "pending" };
    } finally {
      database.close();
    }
    const state = command("/usr/bin/systemctl", [
      "--user",
      "show",
      "--property=ActiveState",
      "--value",
      "docker.service",
    ]).trim();
    if (state === "inactive") return { state: "idle" };
    if (state !== "active")
      throw new Error("Dedicated container engine is unavailable");
    // Include every container, not just our naming convention. Unknown work
    // prevents shutdown; a failing Docker connection is never 'no containers'.
    if (
      command("/usr/bin/docker", ["container", "ls", "--all", "--quiet"]).trim()
    )
      return { state: "containers" };
    // Integrated BuildKit work is not listed by `docker container ls`.
    // Unknown history status also prevents shutdown.
    const builds = command("/usr/bin/docker", [
      "buildx",
      "--builder",
      "default",
      "history",
      "ls",
      "--format",
      "{{.Status}}",
    ])
      .trim()
      .split("\n")
      .filter(Boolean);
    if (builds.some((status) => !["Completed", "Error"].includes(status)))
      return { state: "builds" };
    command("/usr/bin/systemctl", ["--user", "stop", "docker.service"]);
    if (
      command("/usr/bin/systemctl", [
        "--user",
        "show",
        "--property=ActiveState",
        "--value",
        "docker.service",
      ]).trim() !== "inactive"
    )
      throw new Error("Could not confirm dedicated container engine shutdown");
    return { state: "idle", stopped: true };
  } catch (error) {
    if (["ENGINE_BUSY", "MUTATION_LOCK_BUSY"].includes(error.code))
      return { state: "busy" };
    throw error;
  } finally {
    try {
      await engine?.release();
    } finally {
      await mutation?.release();
    }
  }
}
if (isMainModule(import.meta.url)) {
  if (process.getuid() !== 0 || process.argv.length !== 2)
    throw new Error("Engine idle collection requires the fixed root service");
  console.log(JSON.stringify(await idleContainerEngine()));
}
