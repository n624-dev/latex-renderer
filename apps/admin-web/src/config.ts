export interface WebConfig {
  clientDistRoot: string;
  publicOrigin: string;
  port: number;
  renderingHealthUrl: string;
  statusProbeTimeoutMs: number;
}
export function loadWebConfig(): WebConfig {
  return {
    clientDistRoot: required("CLIENT_DIST_ROOT"),
    publicOrigin: process.env.PUBLIC_ORIGIN ?? "https://latex-render.n624.jp",
    port: validPortEnvironment(process.env, "PORT", 3101),
    renderingHealthUrl:
      process.env.RENDERING_HEALTH_URL ??
      "http://127.0.0.1:3102/health/rendering",
    statusProbeTimeoutMs: positiveDurationEnvironment(
      process.env,
      "STATUS_PROBE_TIMEOUT_MS",
      1500,
      120_000,
    ),
  };
}
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
import {
  positiveDurationEnvironment,
  validPortEnvironment,
} from "@latex-renderer/shared";
