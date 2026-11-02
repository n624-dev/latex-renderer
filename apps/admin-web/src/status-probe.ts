import {
  httpServicesSnapshot,
  type HttpServiceState,
} from "../../../deploy/scripts/http-services.mjs";
import { readWorkerHealth } from "../../../deploy/scripts/worker-health.mjs";
import type { ClientDistribution } from "./client-distribution.js";
import type { WebConfig } from "./config.js";

export interface StatusSnapshot {
  api: boolean;
  rendering: boolean;
  downloads: boolean;
  checkedAt: string;
  apiIdle?: boolean;
}
export type StatusProbe = () => Promise<StatusSnapshot>;
interface ProbeDependencies {
  services?: () => { managed: boolean; services: HttpServiceState[] };
  worker?: () => { operational: boolean; state: string };
}
export function createStatusProbe(
  config: WebConfig,
  distribution: ClientDistribution,
  dependencies: ProbeDependencies = {},
): StatusProbe {
  return async () => {
    const snapshot = (dependencies.services ?? httpServicesSnapshot)();
    const downloads =
      distribution.archive.byteLength > 0 &&
      distribution.manifest.byteLength > 0 &&
      distribution.installer.byteLength > 0;
    if (snapshot.managed) {
      const api = snapshot.services.find(
        (entry) => entry.service === "latex-renderer-api.service",
      );
      const admin = snapshot.services.find(
        (entry) => entry.service === "latex-renderer-admin-api.service",
      );
      const [apiHealthy, rendering] = await Promise.all([
        api?.state === "idle"
          ? true
          : api?.state === "running" &&
            (await healthy(
              "http://127.0.0.1:3100/health",
              config.statusProbeTimeoutMs,
            )),
        admin?.state === "running"
          ? healthy(config.renderingHealthUrl, config.statusProbeTimeoutMs)
          : admin?.state === "idle" &&
            (dependencies.worker ?? readWorkerHealth)().operational,
      ]);
      return {
        api: apiHealthy === true,
        rendering,
        downloads,
        checkedAt: new Date().toISOString(),
        apiIdle: api?.state === "idle",
      };
    }
    // Ordinary local development has no systemd listeners or runtime health file.
    const [api, rendering] = await Promise.all([
      healthy(
        new URL("/api/v1/health", config.publicOrigin).toString(),
        config.statusProbeTimeoutMs,
      ),
      healthy(config.renderingHealthUrl, config.statusProbeTimeoutMs),
    ]);
    return { api, rendering, downloads, checkedAt: new Date().toISOString() };
  };
}
async function healthy(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "application/json" },
    });
    return response.ok;
  } catch {
    return false;
  }
}
