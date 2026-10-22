import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import type { WorkerConfig } from "./config.js";
import { containerMemoryProbe } from "./container-memory.js";
import { MIB, RENDER_MEMORY_MAX } from "./memory-plan.js";

export interface RendererStageOptions {
  mode: "pdf" | "svg" | "preview";
  pdfDirectory?: string;
  page?: number;
}

export function spawnRenderer(
  config: WorkerConfig,
  jobId: string,
  leaseGeneration: number,
  extracted: string,
  staging: string,
  entrypoint = "main.tex",
  outputs: readonly string[] = ["pdf"],
  stage?: RendererStageOptions,
) {
  const containerName = rendererContainerName(
    jobId,
    leaseGeneration,
    stage?.mode === "preview" ? stage.page : undefined,
  );
  const args = rendererRunArguments(
    config,
    jobId,
    extracted,
    staging,
    entrypoint,
    outputs,
    leaseGeneration,
    stage,
  );
  const process = spawn("docker", args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: dockerEnvironment(),
  });
  if (config.observeContainerMemory && stage?.mode !== "preview") {
    const probe = containerMemoryProbe(containerName, (name) =>
      runDocker(["inspect", "--format", "{{.Id}} {{.State.Pid}}", name], 2000),
    );
    let busy = false,
      closed = false;
    const timer = setInterval(() => {
      if (busy || closed) return;
      busy = true;
      void probe()
        .then((peak) => {
          if (!closed && peak !== undefined)
            config.observeContainerMemory?.(
              `${containerName}:${stage?.mode ?? "all"}`,
              peak,
            );
        })
        .catch(() => {})
        .finally(() => {
          busy = false;
        });
    }, 1000);
    timer.unref();
    const stop = () => {
      closed = true;
      clearInterval(timer);
    };
    process.once("close", stop);
    process.once("error", stop);
  }
  return {
    process,
    containerName,
  };
}
export function rendererRunArguments(
  config: WorkerConfig,
  jobId: string,
  extracted: string,
  staging: string,
  entrypoint = "main.tex",
  outputs: readonly string[] = ["pdf"],
  leaseGeneration = 0,
  stage?: RendererStageOptions,
): string[] {
  const memory = config.containerMemoryBytes ?? RENDER_MEMORY_MAX;
  if (
    !Number.isSafeInteger(memory) ||
    memory < 128 * MIB ||
    memory > RENDER_MEMORY_MAX ||
    memory % (64 * MIB) !== 0
  )
    throw new Error("Invalid worker-selected renderer memory cap");
  const memoryArgument = memory === RENDER_MEMORY_MAX ? "1g" : String(memory);
  if (
    (stage?.mode === "svg" || stage?.mode === "preview") &&
    stage.pdfDirectory === undefined
  )
    throw new Error("Conversion stage requires an immutable PDF checkpoint");
  if (
    stage?.mode === "preview" &&
    (!Number.isSafeInteger(stage.page) ||
      (stage.page ?? 0) < 1 ||
      (stage.page ?? 0) > 100)
  )
    throw new Error("Invalid preview page");
  const securityOptions = [
    "--security-opt",
    "no-new-privileges",
    "--security-opt",
    `seccomp=${config.seccompProfile}`,
  ];
  if (config.apparmorProfile !== undefined)
    securityOptions.push(
      "--security-opt",
      `apparmor=${config.apparmorProfile}`,
    );
  return [
    "run",
    "--rm",
    "--init",
    "--name",
    rendererContainerName(
      jobId,
      leaseGeneration,
      stage?.mode === "preview" ? stage.page : undefined,
    ),
    "--label",
    `latex-renderer.job=${jobId}`,
    "--label",
    `latex-renderer.lease-generation=${leaseGeneration}`,
    "--network",
    "none",
    "--read-only",
    "--user",
    `${config.containerUid}:${config.containerGid}`,
    "--cap-drop",
    "ALL",
    ...securityOptions,
    "--pids-limit",
    "128",
    "--cpus",
    "1.5",
    "--memory",
    stage?.mode === "preview" ? "256m" : memoryArgument,
    "--memory-swap",
    stage?.mode === "preview" ? "256m" : memoryArgument,
    ...(stage?.mode === "preview"
      ? [
          "--ulimit",
          `fsize=${Math.min(config.maxOutputBytes, 10 * 1024 * 1024)}:${Math.min(config.maxOutputBytes, 10 * 1024 * 1024)}`,
        ]
      : []),
    "--tmpfs",
    `/tmp:rw,noexec,nosuid,nodev,size=256m,uid=${config.containerUid},gid=${config.containerGid}`,
    "--env",
    `LATEX_ENTRYPOINT=${entrypoint}`,
    "--env",
    `LATEX_OUTPUTS=${outputs.join(",")}`,
    "--env",
    `MAX_SVG_OBJECTS=${config.maxSvgObjects}`,
    "--env",
    `MAX_SVG_BYTES=${config.maxSvgBytes}`,
    "--env",
    `MAX_SVG_TOTAL_BYTES=${config.maxSvgTotalBytes}`,
    "--env",
    `SVG_CONVERSION_TIMEOUT_SECONDS=${config.svgConversionTimeoutSeconds}`,
    "--mount",
    `type=bind,src=${extracted},dst=/work/input,readonly`,
    "--mount",
    `type=bind,src=${staging},dst=/work/output`,
    ...(stage === undefined
      ? []
      : ["--env", `LATEX_RENDER_STAGE=${stage.mode}`]),
    ...(stage?.mode === "preview"
      ? ["--env", `LATEX_PREVIEW_PAGE=${stage.page ?? 0}`]
      : []),
    ...(stage?.pdfDirectory === undefined
      ? []
      : [
          "--mount",
          `type=bind,src=${stage.pdfDirectory},dst=/work/pdf,readonly`,
        ]),
    config.image,
  ];
}
export function rendererContainerName(
  jobId: string,
  leaseGeneration: number,
  previewPage?: number,
): string {
  if (!Number.isSafeInteger(leaseGeneration) || leaseGeneration < 0)
    throw new Error("Worker lease generation is invalid");
  if (
    previewPage !== undefined &&
    (!Number.isSafeInteger(previewPage) || previewPage < 1 || previewPage > 100)
  )
    throw new Error("Invalid preview page");
  return `latex-render-${jobId}${previewPage === undefined ? "" : `-p${previewPage}`}-g${leaseGeneration}`;
}
export async function dockerStop(name: string): Promise<void> {
  await dockerStopVerified(name);
}
export async function dockerStopVerified(identifier: string): Promise<void> {
  if (
    !/^[a-f0-9]{12,64}$/.test(identifier) &&
    !/^latex-render-[A-Za-z0-9_-]+-g[0-9]+$/.test(identifier)
  )
    throw new Error("Invalid renderer container identifier");
  const deadline = performance.now() + 15_000;
  const command = (args: readonly string[], limit: number) => {
    const remaining = Math.floor(deadline - performance.now());
    if (remaining < 1) throw new Error("Renderer cleanup deadline exceeded");
    return runDocker(args, Math.min(limit, remaining));
  };
  await command(["stop", "--time", "2", identifier], 5_000).catch(
    () => undefined,
  );
  await command(["kill", identifier], 2_000).catch(() => undefined);
  const selector = /^[a-f0-9]{12,64}$/.test(identifier)
    ? `id=${identifier}`
    : `name=^${identifier}$`;
  const present = async () =>
    (await command(["ps", "-aq", "--filter", selector], 2_000)).trim() !== "";
  if (!(await present())) return;
  // stop/kill acknowledgements do not prove that --rm has finished removing
  // the container. Remove only this exact lease generation, then wait for
  // confirmed absence. An unavailable daemon never counts as successful cleanup.
  await command(["rm", "--force", identifier], 3_000).catch(() => undefined);
  const confirmationDeadline = Math.min(
    deadline - 1_000,
    performance.now() + 5_000,
  );
  while (performance.now() < confirmationDeadline) {
    if (!(await present())) return;
    const remaining = Math.floor(confirmationDeadline - performance.now());
    if (remaining > 0) await delay(Math.min(250, remaining));
  }
  const result = await command(
    ["inspect", "--format", "{{.State.Status}}", identifier],
    1_000,
  ).catch(() => "unavailable");
  const state =
    /^(created|running|paused|restarting|removing|exited|dead)$/.test(
      result.trim(),
    )
      ? result.trim()
      : "unavailable";
  throw new Error(
    `Renderer container could not be stopped: ${identifier} (state=${state})`,
  );
}
export async function assertDockerIsolation(
  apparmorProfile: string | undefined,
): Promise<void> {
  const output = await runDocker([
    "info",
    "--format",
    "{{json .SecurityOptions}}",
  ]).catch(() => "");
  validateDockerIsolation(
    output,
    apparmorProfile,
    process.env.ALLOW_ROOTFUL_DOCKER === "true",
  );
  const limits = await runDocker([
    "info",
    "--format",
    "{{.MemoryLimit}} {{.SwapLimit}}",
  ]).catch(() => "");
  validateDockerMemoryLimits(limits);
}
export function validateDockerMemoryLimits(value: string): void {
  if (value.trim() !== "true true")
    throw new Error(
      "Docker memory and swap limit enforcement is required for render admission",
    );
}
export function validateDockerIsolation(
  options: string,
  apparmorProfile: string | undefined,
  allowRootful: boolean,
): void {
  const rootless = options.includes("rootless");
  if (!rootless && !allowRootful)
    throw new Error(
      "Rootless Docker is required; set ALLOW_ROOTFUL_DOCKER=true only for isolated development",
    );
  if (rootless && apparmorProfile !== undefined)
    throw new Error(
      "AppArmor is unsupported by rootless Docker; unset RENDERER_APPARMOR_PROFILE",
    );
  if (
    !rootless &&
    apparmorProfile !== undefined &&
    !options.includes("apparmor")
  )
    throw new Error("The configured Docker daemon does not support AppArmor");
}
export function runDocker(
  args: readonly string[],
  timeoutMs = 15_000,
): Promise<string> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
    throw new Error("Invalid Docker command timeout");
  return new Promise((resolve, reject) => {
    const child = spawn("docker", [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: dockerEnvironment(),
    });
    let stdout = "",
      stderr = "";
    let failure: Error | undefined;
    const timer = setTimeout(() => {
      failure = new Error("Docker command timed out");
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length + chunk.length > 1024 * 1024) {
        failure = new Error("Docker response exceeds limit");
        child.kill("SIGKILL");
      } else stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-8192);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code === 0) resolve(stdout);
      else reject(new Error(stderr));
    });
  });
}

export class RendererCleanupDeferred extends Error {}
function dockerEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
  for (const name of [
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
  ] as const) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}
