import { spawn } from "node:child_process";
import type { WorkerConfig } from "./config.js";

export function spawnRenderer(
  config: WorkerConfig,
  jobId: string,
  leaseGeneration: number,
  extracted: string,
  staging: string,
  entrypoint = "main.tex",
  outputs: readonly string[] = ["pdf"],
) {
  const containerName = rendererContainerName(jobId, leaseGeneration);
  const args = rendererRunArguments(
    config,
    jobId,
    extracted,
    staging,
    entrypoint,
    outputs,
    leaseGeneration,
  );
  return {
    process: spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: dockerEnvironment(),
    }),
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
): string[] {
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
    rendererContainerName(jobId, leaseGeneration),
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
    "1g",
    "--memory-swap",
    "1g",
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
    config.image,
  ];
}
export function rendererContainerName(
  jobId: string,
  leaseGeneration: number,
): string {
  if (!Number.isSafeInteger(leaseGeneration) || leaseGeneration < 0)
    throw new Error("Worker lease generation is invalid");
  return `latex-render-${jobId}-g${leaseGeneration}`;
}
export async function dockerStop(name: string): Promise<void> {
  await runDocker(["stop", "--time", "2", name]).catch(() => undefined);
  await runDocker(["kill", name]).catch(() => undefined);
}
export async function dockerStopVerified(identifier: string): Promise<void> {
  await runDocker(["stop", "--time", "2", identifier]).catch(() => undefined);
  await runDocker(["kill", identifier]).catch(() => undefined);
  const remaining = (
    await runDocker(["ps", "-aq", "--filter", `id=${identifier}`])
  ).trim();
  if (remaining !== "")
    throw new Error(`Renderer container could not be stopped: ${identifier}`);
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
export function runDocker(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: dockerEnvironment(),
    });
    let stdout = "",
      stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr));
    });
  });
}
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
