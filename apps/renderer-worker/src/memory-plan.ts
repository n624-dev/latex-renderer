import { createHash } from "node:crypto";
import type { RendererDatabase } from "@latex-renderer/database";

export const MIB = 1024 ** 2;
export const RENDER_MEMORY_MAX = 1024 * MIB;
const KEY = "worker_memory_profiles_v1";
const MAX_RECORDS = 64;
const TTL = 7 * 86400_000;

export interface MemoryCandidate {
  id: string;
  user_id: string;
  source_sha256: string;
  entrypoint: string;
  outputs_json: string;
  queued_at: string;
}
interface Record {
  key: string;
  peak: number;
  at: number;
}
type Store = Pick<RendererDatabase, "settings">;

export function memoryProfileKey(candidate: MemoryCandidate, image: string) {
  if (!/^(?:sha256:|.+@sha256:)[a-f0-9]{64}$/.test(image)) return;
  if (!/^[a-f0-9]{64}$/.test(candidate.source_sha256)) return;
  try {
    const parsed: unknown = JSON.parse(candidate.outputs_json);
    if (!Array.isArray(parsed)) return;
    const outputs: unknown[] = parsed;
    if (
      outputs.length < 1 ||
      outputs.length > 2 ||
      !outputs.every((v): v is "pdf" | "svg" => v === "pdf" || v === "svg") ||
      !outputs.includes("pdf")
    )
      return;
    return createHash("sha256")
      .update(
        JSON.stringify([
          "memory-plan-v1",
          candidate.user_id,
          candidate.source_sha256,
          candidate.entrypoint,
          image,
          [...new Set(outputs)].sort(),
        ]),
      )
      .digest("hex");
  } catch {
    return;
  }
}

function records(store: Store, now: number): Record[] {
  try {
    const row = store.settings.get(KEY);
    if (!row || row.value_json.length > 16384) return [];
    const value: unknown = JSON.parse(row.value_json);
    if (!Array.isArray(value) || value.length > MAX_RECORDS) return [];
    const entries = (value as unknown[]).filter(
      (r): r is Record =>
        r !== null &&
        typeof r === "object" &&
        "key" in r &&
        typeof r.key === "string" &&
        /^[a-f0-9]{64}$/.test(r.key) &&
        "peak" in r &&
        typeof r.peak === "number" &&
        Number.isSafeInteger(r.peak) &&
        r.peak > 0 &&
        "at" in r &&
        typeof r.at === "number" &&
        Number.isSafeInteger(r.at) &&
        r.at <= now,
    );
    if (
      entries.length !== value.length ||
      new Set(entries.map((r) => r.key)).size !== entries.length
    )
      return [];
    return entries.filter((r) => now - r.at < TTL);
  } catch {
    // This disposable optimization is not lease/protection state. Discarding
    // it restores the full sandbox limit; it never deletes user data.
    return [];
  }
}

export function planRenderMemory(
  store: Store,
  candidate: MemoryCandidate | undefined,
  image: string,
  configuredMinimum: number | undefined,
  now = Date.now(),
  maximum = RENDER_MEMORY_MAX,
) {
  const key = candidate && memoryProfileKey(candidate, image);
  const record = key && records(store, now).find((r) => r.key === key);
  return {
    key,
    // Docker allocates memory on demand. A historical observation must not
    // turn into a lower hard ceiling that kills a still-valid running Job.
    limit: maximum,
    minimum: configuredMinimum,
    estimatedPeak: record ? record.peak : null,
  };
}

/** Only the worker's host-side cgroup observer supplies peakBytes. Never learn
 * from TeX output, compile.log, client-provided hints or another owner's Job. */
export function rememberRenderMemory(
  store: Store,
  key: string | undefined,
  peakBytes: number | undefined,
  succeeded: boolean,
  now = Date.now(),
  maximum = RENDER_MEMORY_MAX,
): void {
  if (!key) return;
  const old = records(store, now);
  let next = old.filter((r) => r.key !== key);
  if (
    succeeded &&
    peakBytes !== undefined &&
    Number.isSafeInteger(peakBytes) &&
    peakBytes > 0 &&
    peakBytes <= maximum
  ) {
    next.push({
      key,
      peak: Math.max(peakBytes, old.find((r) => r.key === key)?.peak ?? 0),
      at: now,
    });
  } else if (succeeded) {
    // Missing observations are unknown, not zero. Do not promote a partial
    // multi-stage run or replace a previous conservative estimate.
    return;
  }
  next = next.sort((a, b) => b.at - a.at).slice(0, MAX_RECORDS);
  store.settings.upsert(KEY, next, "system", new Date(now).toISOString());
}
