#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export async function runGhcrRetention({
  env = process.env,
  fetchImpl = globalThis.fetch,
  spawnImpl = spawnSync,
  sleep = setTimeout,
  now = new Date(),
  log = (record) => console.log(JSON.stringify(record)),
  readManifestImpl,
} = {}) {
  const token = env.GITHUB_TOKEN;
  const owner = env.GHCR_OWNER ?? "n624-dev";
  const packageName = env.GHCR_PACKAGE ?? "latex-renderer-texlive";
  const repository = env.GHCR_REPOSITORY ?? `ghcr.io/${owner}/${packageName}`;
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(owner) ||
    !/^[a-z0-9][a-z0-9._-]*$/.test(packageName) ||
    repository !== `ghcr.io/${owner}/${packageName}`
  )
    throw new Error("Invalid or mismatched GHCR package/repository");
  if (env.GHCR_OWNER_TYPE && !["users", "orgs"].includes(env.GHCR_OWNER_TYPE))
    throw new Error("GHCR_OWNER_TYPE must be users or orgs");
  const ownerType = env.GHCR_OWNER_TYPE ?? "users";
  const purgeLegacyRuntimes = booleanEnvironment(
    env.GHCR_PURGE_LEGACY_RUNTIMES ?? "true",
    "GHCR_PURGE_LEGACY_RUNTIMES",
  );
  const dryRun = booleanEnvironment(
    env.GHCR_DRY_RUN ?? "false",
    "GHCR_DRY_RUN",
  );
  const onDemandRetentionDays = positiveInteger(
    env.GHCR_ON_DEMAND_RETENTION_DAYS ?? "7",
    "GHCR_ON_DEMAND_RETENTION_DAYS",
  );
  const untaggedRetentionDays = positiveInteger(
    env.GHCR_UNTAGGED_RETENTION_DAYS ?? "14",
    "GHCR_UNTAGGED_RETENTION_DAYS",
  );
  const requestTimeoutMs =
    positiveInteger(
      env.GHCR_REQUEST_TIMEOUT_SECONDS ?? "30",
      "GHCR_REQUEST_TIMEOUT_SECONDS",
    ) * 1000;
  if (!token) throw new Error("GITHUB_TOKEN is required");

  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "latex-renderer-ghcr-retention",
  };
  const packagePath = encodeURIComponent(packageName);
  const baseUrl = `https://api.github.com/${ownerType}/${encodeURIComponent(owner)}/packages/container/${packagePath}/versions`;
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const dayMs = 86_400_000;

  function positiveInteger(value, name) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 365)
      throw new Error(`${name} must be an integer between 1 and 365`);
    return parsed;
  }
  function booleanEnvironment(value, name) {
    if (value === "true") return true;
    if (value === "false") return false;
    throw new Error(`${name} must be true or false`);
  }
  function parseDateTag(tag) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tag)) return null;
    const date = new Date(`${tag}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== tag)
      return null;
    return date;
  }
  function parseLegacyRuntimeDateTag(tag) {
    const match = /^runtime-v1-(\d{4}-\d{2}-\d{2})-[a-f0-9]{32}$/.exec(tag);
    return match ? parseDateTag(match[1]) : null;
  }
  function ageDays(date) {
    return Math.floor((today.getTime() - date.getTime()) / dayMs);
  }
  function versionAgeDays(version) {
    const raw = version?.updated_at ?? version?.created_at;
    const value = typeof raw === "string" ? new Date(raw) : null;
    return value && !Number.isNaN(value.getTime())
      ? Math.max(0, ageDays(value))
      : null;
  }
  function isoWeek(date) {
    const value = new Date(date.getTime());
    const day = value.getUTCDay() || 7;
    value.setUTCDate(value.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
    const week = Math.ceil(
      ((value.getTime() - yearStart.getTime()) / dayMs + 1) / 7,
    );
    return `${value.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  function weeklyAge(tag) {
    const match = /^weekly-(\d{4})-W(\d{2})$/.exec(tag);
    if (!match) return null;
    const year = Number(match[1]);
    const week = Number(match[2]);
    if (week < 1 || week > 53) return null;
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4Day = jan4.getUTCDay() || 7;
    const monday = new Date(
      jan4.getTime() - (jan4Day - 1) * dayMs + (week - 1) * 7 * dayMs,
    );
    return ageDays(monday);
  }
  function apiFetch(url, init = {}) {
    return fetchImpl(url, {
      ...init,
      signal: globalThis.AbortSignal.timeout(requestTimeoutMs),
    });
  }
  async function versions() {
    const all = [];
    for (let page = 1; page <= 100; page += 1) {
      const response = await apiFetch(
        `${baseUrl}?state=active&per_page=100&page=${page}`,
        {
          headers,
        },
      );
      if (!response.ok)
        throw new Error(`GHCR version list failed: HTTP ${response.status}`);
      const batch = await response.json();
      if (!Array.isArray(batch))
        throw new Error("Unexpected GHCR version response");
      for (const version of batch) {
        if (
          !Number.isSafeInteger(version?.id) ||
          version.id < 1 ||
          !/^sha256:[a-f0-9]{64}$/.test(version?.name ?? "") ||
          !Array.isArray(version?.metadata?.container?.tags) ||
          version.metadata.container.tags.some((tag) => typeof tag !== "string")
        )
          throw new Error("Invalid GHCR version identity or tags");
        if (all.some((item) => item.id === version.id))
          throw new Error(
            "Duplicate GHCR version ID; retry a stable inventory",
          );
        all.push(version);
      }
      if (batch.length < 100) return all;
    }
    throw new Error("GHCR inventory exceeds 100 pages");
  }
  function tagsOf(version) {
    const tags = version?.metadata?.container?.tags;
    return Array.isArray(tags)
      ? tags.filter((tag) => typeof tag === "string")
      : [];
  }
  const fingerprint = (version) =>
    JSON.stringify([
      version.name,
      [...tagsOf(version)].sort(),
      version.updated_at,
    ]);
  let inventoryBaseline;
  const accountedAbsent = new Set();
  async function deleteVersion(version) {
    // Re-read immediately before DELETE. Workflow-level concurrency serializes
    // this repository's publishers; unexpected concurrent tag changes fail closed.
    const current = await versions();
    const live = current.find((item) => item.id === version.id);
    if (!live) {
      accountedAbsent.add(version.id);
      return "already-absent";
    }
    if (
      live.name !== version.name ||
      JSON.stringify([...tagsOf(live)].sort()) !==
        JSON.stringify([...tagsOf(version)].sort()) ||
      live.updated_at !== version.updated_at
    )
      throw new Error(
        `GHCR version ${version.id} changed since planning; retry`,
      );
    // A newly tagged index could now reference an otherwise unchanged old
    // manifest. Checking only the candidate's tags would miss that race.
    if (
      current.some(
        (item) => inventoryBaseline.get(item.id) !== fingerprint(item),
      ) ||
      [...inventoryBaseline.keys()].some(
        (id) =>
          !accountedAbsent.has(id) && !current.some((item) => item.id === id),
      )
    )
      throw new Error(
        "GHCR inventory changed since reference checks; replan before deleting",
      );
    const response = await apiFetch(`${baseUrl}/${version.id}`, {
      method: "DELETE",
      headers,
    });
    log({
      event: "delete_response",
      versionId: version.id,
      status: response.status,
    });
    if (response.status !== 204 && response.status !== 404)
      throw new Error(
        `Failed to delete GHCR version ${version.id}: HTTP ${response.status}; check package Admin access and download limits`,
      );
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const active = await versions();
      if (!active.some((item) => item.id === version.id)) {
        const result = response.status === 204 ? "deleted" : "already-absent";
        accountedAbsent.add(version.id);
        log({
          event: "delete_verified",
          versionId: version.id,
          result,
          attempt,
        });
        return result;
      }
      if (attempt < 3) await sleep(1000);
    }
    throw new Error(
      `GHCR version ${version.id} remains active after DELETE HTTP ${response.status}; deletion NOT confirmed`,
    );
  }

  let list = await versions();
  if (!dryRun) {
    // Write/push permission is not package Admin/delete permission. This is a
    // non-mutating permission preflight; actual DELETE still needs verification.
    const permission = await apiFetch(`${baseUrl}?state=deleted&per_page=1`, {
      headers,
    });
    if (!permission.ok)
      throw new Error(
        `GHCR deletion preflight HTTP ${permission.status}; grant this repository Admin in package Manage Actions access (CLI tokens need read:packages and delete:packages)`,
      );
  }
  const dated = [];
  for (const version of list) {
    for (const tag of tagsOf(version)) {
      const date = parseDateTag(tag);
      if (date) dated.push({ tag, date, versionId: version.id });
    }
  }

  const weeklyChoices = new Map();
  for (const item of dated) {
    const age = ageDays(item.date);
    if (age < 15 || age > 90) continue;
    const week = isoWeek(item.date);
    const previous = weeklyChoices.get(week);
    if (!previous || item.date > previous.date) weeklyChoices.set(week, item);
  }

  for (const [week, item] of weeklyChoices) {
    const weeklyTag = `weekly-${week}`;
    if (dryRun) continue;
    const result = spawnImpl(
      "docker",
      [
        "buildx",
        "imagetools",
        "create",
        "--prefer-index=false",
        "--tag",
        `${repository}:${weeklyTag}`,
        `${repository}:${item.tag}`,
      ],
      { stdio: "inherit", timeout: requestTimeoutMs },
    );
    if (result.status !== 0)
      throw new Error(`Failed to promote ${item.tag} to ${weeklyTag}`);
  }

  list = await versions();
  for (const [week, item] of weeklyChoices) {
    const weeklyTag = `weekly-${week}`;
    const selected = list.find((version) => version.id === item.versionId);
    if (!selected || !tagsOf(selected).includes(item.tag))
      throw new Error(`Weekly source changed: ${item.tag}`);
    if (dryRun) {
      for (const version of list)
        version.metadata.container.tags = tagsOf(version).filter(
          (tag) => tag !== weeklyTag,
        );
      selected.metadata.container.tags.push(weeklyTag);
    } else {
      const target = list.filter((version) =>
        tagsOf(version).includes(weeklyTag),
      );
      if (
        target.length !== 1 ||
        target[0].id !== item.versionId ||
        target[0].name !== selected.name
      )
        throw new Error(
          `Weekly alias ${weeklyTag} does not reference verified source ${item.tag}`,
        );
    }
  }
  const selectedDates = new Set(
    [...weeklyChoices.values()].map((item) => item.tag),
  );
  const candidates = [];
  for (const version of list) {
    const tags = tagsOf(version);
    const versionAge = versionAgeDays(version);
    if (tags.length === 0) {
      if (versionAge === null || versionAge <= untaggedRetentionDays) continue;
      candidates.push({ version, kind: "untagged" });
      continue;
    }

    const legacyRuntimeTags = tags.filter(parseLegacyRuntimeDateTag);
    if (legacyRuntimeTags.length > 0) {
      // Registry Runtime support has ended. Hosts build their Runtime locally.
      if (!purgeLegacyRuntimes) continue;
      if (legacyRuntimeTags.length !== tags.length) continue;
      candidates.push({ version, kind: "legacy-runtime" });
      continue;
    }

    const unknown = tags.some(
      (tag) =>
        tag !== "latest" && !parseDateTag(tag) && weeklyAge(tag) === null,
    );
    if (unknown) continue;
    let protectedVersion = tags.includes("latest");
    for (const tag of tags) {
      const date = parseDateTag(tag);
      if (date) {
        const age = ageDays(date);
        if (
          age <= 14 ||
          (age >= 15 && age <= 90 && selectedDates.has(tag)) ||
          (age > 14 &&
            (versionAge === null || versionAge <= onDemandRetentionDays))
        )
          protectedVersion = true;
        continue;
      }
      const age = weeklyAge(tag);
      if (age !== null && age <= 90) protectedVersion = true;
    }
    if (protectedVersion) continue;
    candidates.push({ version, kind: "base" });
  }

  // An untagged manifest can be a child of a retained multi-platform index or
  // an attestation subject. Read manifests, never layers, and preserve reachable
  // descendants transitively. Corrupt/unknown manifests stop cleanup.
  const candidateIds = new Set(candidates.map(({ version }) => version.id));
  const protectedDigests = new Set(
    list
      .filter((version) => !candidateIds.has(version.id))
      .map((version) => version.name),
  );
  if (candidates.length > 0) {
    const references = new Map();
    for (const version of list) {
      let manifest;
      if (readManifestImpl) manifest = await readManifestImpl(version.name);
      else {
        const result = spawnImpl(
          "docker",
          [
            "buildx",
            "imagetools",
            "inspect",
            `${repository}@${version.name}`,
            "--raw",
          ],
          {
            encoding: "utf8",
            maxBuffer: 2 * 1024 * 1024,
            timeout: requestTimeoutMs,
          },
        );
        if (result.status !== 0)
          throw new Error(`Cannot inspect GHCR manifest ${version.id}`);
        manifest = JSON.parse(result.stdout);
      }
      const imageTypes = [
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.v2+json",
      ];
      const indexTypes = [
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
      ];
      if (
        !manifest ||
        manifest.schemaVersion !== 2 ||
        ![...imageTypes, ...indexTypes].includes(manifest.mediaType) ||
        (indexTypes.includes(manifest.mediaType) &&
          !Array.isArray(manifest.manifests))
      )
        throw new Error(`Invalid/unsupported GHCR manifest ${version.id}`);
      const descriptors = [
        ...(manifest.manifests ?? []),
        ...(manifest.subject ? [manifest.subject] : []),
      ];
      if (
        descriptors.some(
          (descriptor) =>
            !/^sha256:[a-f0-9]{64}$/.test(descriptor?.digest ?? ""),
        )
      )
        throw new Error(`Invalid GHCR manifest reference ${version.id}`);
      references.set(
        version.name,
        descriptors.map((descriptor) => descriptor.digest),
      );
    }
    const pending = [...protectedDigests];
    for (let index = 0; index < pending.length; index += 1) {
      for (const digest of references.get(pending[index]) ?? []) {
        if (!protectedDigests.has(digest)) {
          protectedDigests.add(digest);
          pending.push(digest);
        }
        // A referenced index missing from the package inventory cannot be safely
        // traversed here; stop rather than guess its descendants are unused.
        if (!references.has(digest))
          throw new Error(
            "Referenced manifest missing from inventory; cannot prove untagged safety",
          );
      }
    }
  }
  const planned = candidates.filter(
    ({ version }) => !protectedDigests.has(version.name),
  );
  inventoryBaseline = new Map(
    list.map((version) => [version.id, fingerprint(version)]),
  );
  log({
    event: "retention_plan",
    dryRun,
    candidates: planned.map(({ version, kind }) => ({
      versionId: version.id,
      tags: tagsOf(version),
      kind,
    })),
    weekly: [...weeklyChoices].map(([week, item]) => ({
      tag: `weekly-${week}`,
      source: item.tag,
      versionId: item.versionId,
    })),
  });
  let deleted = 0,
    deletedUntagged = 0,
    deletedLegacyRuntimes = 0,
    alreadyAbsent = 0;
  if (!dryRun)
    for (const { version, kind } of planned) {
      if ((await deleteVersion(version)) !== "deleted") {
        alreadyAbsent += 1;
        continue;
      }
      deleted += 1;
      if (kind === "untagged") deletedUntagged += 1;
      if (kind === "legacy-runtime") deletedLegacyRuntimes += 1;
    }
  const summary = {
    event: "retention_complete",
    dryRun,
    plannedVersions: planned.length,
    alreadyAbsentVersions: alreadyAbsent,
    weeklyAliases: weeklyChoices.size,
    deletedVersions: deleted,
    deletedUntaggedVersions: deletedUntagged,
    deletedLegacyRuntimeVersions: deletedLegacyRuntimes,
    purgeLegacyRuntimes,
    onDemandRetentionDays,
    untaggedRetentionDays,
  };
  log(summary);
  return summary;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runGhcrRetention().catch((error) => {
    console.error(
      JSON.stringify({ event: "retention_failed", error: error.message }),
    );
    process.exitCode = 1;
  });
}
