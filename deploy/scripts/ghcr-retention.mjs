#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const token = process.env.GITHUB_TOKEN;
const owner = process.env.GHCR_OWNER ?? "n624-dev";
const packageName = process.env.GHCR_PACKAGE ?? "latex-renderer-texlive";
const repository = process.env.GHCR_REPOSITORY ?? `ghcr.io/${owner}/${packageName}`;
const ownerType = process.env.GHCR_OWNER_TYPE === "orgs" ? "orgs" : "users";
const onDemandRetentionDays = positiveInteger(process.env.GHCR_ON_DEMAND_RETENTION_DAYS ?? "7", "GHCR_ON_DEMAND_RETENTION_DAYS");
const untaggedRetentionDays = positiveInteger(process.env.GHCR_UNTAGGED_RETENTION_DAYS ?? "14", "GHCR_UNTAGGED_RETENTION_DAYS");
const requestTimeoutMs = positiveInteger(process.env.GHCR_REQUEST_TIMEOUT_SECONDS ?? "30", "GHCR_REQUEST_TIMEOUT_SECONDS") * 1000;
if (!token) throw new Error("GITHUB_TOKEN is required");

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "latex-renderer-ghcr-retention",
};
const packagePath = encodeURIComponent(packageName);
const baseUrl = `https://api.github.com/${ownerType}/${encodeURIComponent(owner)}/packages/container/${packagePath}/versions`;
const now = new Date();
const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const dayMs = 86_400_000;

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 365)
    throw new Error(`${name} must be an integer between 1 and 365`);
  return parsed;
}
function parseDateTag(tag) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tag)) return null;
  const date = new Date(`${tag}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== tag) return null;
  return date;
}
function parseRuntimeDateTag(tag) {
  const match = /^runtime-v1-(\d{4}-\d{2}-\d{2})-[a-f0-9]{32}$/.exec(tag);
  return match ? parseDateTag(match[1]) : null;
}
function ageDays(date) {
  return Math.floor((today.getTime() - date.getTime()) / dayMs);
}
function versionAgeDays(version) {
  const raw = version?.updated_at ?? version?.created_at;
  const value = typeof raw === "string" ? new Date(raw) : null;
  return value && !Number.isNaN(value.getTime()) ? Math.max(0, ageDays(value)) : Number.MAX_SAFE_INTEGER;
}
function isoWeek(date) {
  const value = new Date(date.getTime());
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((value.getTime() - yearStart.getTime()) / dayMs) + 1) / 7);
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
  const monday = new Date(jan4.getTime() - (jan4Day - 1) * dayMs + (week - 1) * 7 * dayMs);
  return ageDays(monday);
}
function apiFetch(url, init = {}) {
  return globalThis.fetch(url, {
    ...init,
    signal: globalThis.AbortSignal.timeout(requestTimeoutMs),
  });
}
async function versions() {
  const all = [];
  for (let page = 1; ; page += 1) {
    const response = await apiFetch(`${baseUrl}?per_page=100&page=${page}`, { headers });
    if (!response.ok) throw new Error(`GHCR version list failed: ${response.status} ${await response.text()}`);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error("Unexpected GHCR version response");
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}
function tagsOf(version) {
  const tags = version?.metadata?.container?.tags;
  return Array.isArray(tags) ? tags.filter((tag) => typeof tag === "string") : [];
}
async function deleteVersion(version) {
  const response = await apiFetch(`${baseUrl}/${version.id}`, { method: "DELETE", headers });
  if (!response.ok && response.status !== 404)
    throw new Error(`Failed to delete GHCR version ${version.id}: ${response.status} ${await response.text()}`);
}

let list = await versions();
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
  const result = spawnSync(
    "docker",
    [
      "buildx", "imagetools", "create",
      "--prefer-index=false",
      "--tag", `${repository}:${weeklyTag}`,
      `${repository}:${item.tag}`,
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error(`Failed to promote ${item.tag} to ${weeklyTag}`);
}

list = await versions();
const selectedDates = new Set([...weeklyChoices.values()].map((item) => item.tag));
let deleted = 0;
let deletedUntagged = 0;
for (const version of list) {
  const tags = tagsOf(version);
  const versionAge = versionAgeDays(version);
  if (tags.length === 0) {
    if (versionAge <= untaggedRetentionDays) continue;
    await deleteVersion(version);
    deleted += 1;
    deletedUntagged += 1;
    continue;
  }

  const unknown = tags.some((tag) => tag !== "latest" && !parseDateTag(tag) && !parseRuntimeDateTag(tag) && !/^weekly-\d{4}-W\d{2}$/.test(tag));
  if (unknown) continue;
  let protectedVersion = tags.includes("latest");
  for (const tag of tags) {
    const date = parseDateTag(tag);
    const runtimeDate = parseRuntimeDateTag(tag);
    if (date || runtimeDate) {
      const effectiveDate = date ?? runtimeDate;
      const age = ageDays(effectiveDate);
      if (
        age <= 14 ||
        (date && age >= 15 && age <= 90 && selectedDates.has(tag)) ||
        (age > 14 && versionAge <= onDemandRetentionDays)
      ) protectedVersion = true;
      continue;
    }
    const age = weeklyAge(tag);
    if (age !== null && age <= 90) protectedVersion = true;
  }
  if (protectedVersion) continue;
  await deleteVersion(version);
  deleted += 1;
}

console.log(JSON.stringify({
  weeklyAliases: weeklyChoices.size,
  deletedVersions: deleted,
  deletedUntaggedVersions: deletedUntagged,
  onDemandRetentionDays,
  untaggedRetentionDays,
}));
