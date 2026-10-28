#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { URL } from "node:url";
import { performance } from "node:perf_hooks";
import { setTimeout } from "node:timers/promises";

// Trusted CI selects the VPS's published inventory, not whichever older date
// happens to answer a network probe. Only tiny metadata is read here. Payload
// signatures/checksums remain mandatory in the ordinary Base installation.
const supportedYear = 2026;
const hashPattern = /^[a-f0-9]{128}$/;
const snapshotPattern =
  /^tl(20\d{2})-([a-f0-9]{16})-([a-f0-9]{16})-[a-f0-9]{16}-v[1-9][0-9]*$/;

function calendarDate(value) {
  if (typeof value !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(value))
    throw new Error("Snapshot must be a valid YYYY-MM-DD date");
  const time = Date.parse(value + "T00:00:00.000Z");
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 10) !== value
  )
    throw new Error("Snapshot must be a valid YYYY-MM-DD date");
  if (!value.startsWith(`${supportedYear}-`))
    throw new Error("Explicit TeX Live annual migration is required");
  return value;
}

async function readSmall(url, label) {
  // One immutable URL, fresh response per attempt. curl's internal retry hides
  // connection phases and can concatenate partial bodies on a piped output.
  const budgetMs = 180_000;
  const started = performance.now();
  const marker = "\n__TEXLIVE_CURL_METRICS__";
  let lastCode = "unavailable";
  for (let attempt = 1; attempt <= 4; attempt++) {
    const remaining = budgetMs - (performance.now() - started);
    if (remaining < 1000) break;
    const maxTime = Math.min(
      Number(process.env.TEXLIVE_CURL_MAX_TIME_SECONDS ?? "60"),
      remaining / 1000,
    );
    let output, code;
    try {
      output = execFileSync(
        "curl",
        [
          "--disable",
          "--fail",
          "--silent",
          "--show-error",
          "--proto",
          "=https",
          "--connect-timeout",
          String(
            Math.min(
              Number(process.env.TEXLIVE_CURL_CONNECT_TIMEOUT_SECONDS ?? "30"),
              maxTime,
            ),
          ),
          "--max-time",
          String(maxTime),
          "--max-filesize",
          "65536",
          "--write-out",
          `${marker}%{json}`,
          url,
        ],
        {
          encoding: "utf8",
          maxBuffer: 80 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: Math.ceil(maxTime * 1000),
          killSignal: "SIGKILL",
        },
      );
      code = 0;
    } catch (error) {
      code =
        typeof error?.status === "number"
          ? error.status
          : error?.code === "ETIMEDOUT"
            ? 28
            : "unavailable";
      output = typeof error?.stdout === "string" ? error.stdout : "";
    }
    lastCode = code;
    const boundary = output.lastIndexOf(marker);
    let metrics;
    try {
      metrics =
        boundary < 0
          ? null
          : JSON.parse(output.slice(boundary + marker.length));
    } catch {
      // Keep the original transport failure if curl was killed before write-out.
      metrics = null;
    }
    const http =
      Number.isInteger(metrics?.http_code) &&
      metrics.http_code >= 0 &&
      metrics.http_code <= 599
        ? metrics.http_code
        : null;
    const record = {
      kind: "texlive_metadata_request",
      stage: label,
      attempt,
      curlExit: code,
      httpStatus: http,
    };
    for (const key of [
      "time_namelookup",
      "time_connect",
      "time_appconnect",
      "time_starttransfer",
      "time_total",
    ]) {
      const value = metrics?.[key];
      if (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 1000
      )
        record[key] = value;
    }
    // Whitelist only phase timings and status. Never log curl's full JSON,
    // URL, response, stderr or child_process exception (which contain URLs).
    console.error(JSON.stringify(record));
    if (code === 0) {
      if (boundary < 0 || http !== 200)
        throw new Error(`${label} returned invalid transport metadata`);
      return output.slice(0, boundary);
    }
    const transient =
      [5, 6, 7, 28, 52, 55, 56].includes(code) ||
      (code === 22 && [408, 429, 500, 502, 503, 504].includes(http));
    if (!transient || attempt === 4) break;
    const delay = 2000 * 2 ** (attempt - 1);
    if (performance.now() - started + delay + 1000 >= budgetMs) break;
    await setTimeout(delay);
  }
  throw new Error(
    `${label} request failed (curl ${lastCode}); refusing to select another date`,
  );
}

function checksum(text, filename) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length !== 1)
    throw new Error("Canonical checksum metadata is malformed");
  const fields = lines[0].trim().split(/\s+/);
  if (
    fields.length !== 2 ||
    !hashPattern.test(fields[0].toLowerCase()) ||
    fields[1].replace(/^\*/, "") !== filename
  )
    throw new Error("Canonical checksum metadata is malformed");
  return fields[0].toLowerCase();
}

async function main() {
  const host = process.env.TEXLIVE_CI_MIRROR_HOST;
  if (
    !host ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host) ||
    host.includes("..")
  )
    throw new Error("A valid CI mirror hostname is required");
  const origin = new URL(`https://${host}`);
  if (
    origin.hostname !== host.toLowerCase() ||
    origin.port ||
    origin.pathname !== "/"
  )
    throw new Error("A valid CI mirror hostname is required");
  const requested = process.argv[2] ?? "latest";
  let date,
    snapshotId = "",
    expectedInstaller,
    expectedDatabase;
  if (requested === "latest") {
    if (new Date().getUTCFullYear() !== supportedYear)
      throw new Error("Explicit TeX Live annual migration is required");
    let pointer;
    const pointerText = await readSmall(
      new URL("/latest.json", origin).href,
      "Published mirror metadata",
    );
    try {
      pointer = JSON.parse(pointerText);
    } catch {
      throw new Error("Published mirror metadata is not valid JSON");
    }
    if (
      typeof pointer !== "object" ||
      pointer === null ||
      Array.isArray(pointer) ||
      pointer.schemaVersion !== 1
    )
      throw new Error("CI mirror metadata must be upgraded to schemaVersion 1");
    const match =
      typeof pointer.snapshotId === "string"
        ? snapshotPattern.exec(pointer.snapshotId)
        : null;
    if (
      !match ||
      Number(match[1]) !== supportedYear ||
      typeof pointer.installerSha512 !== "string" ||
      !hashPattern.test(pointer.installerSha512) ||
      typeof pointer.databaseSha512 !== "string" ||
      !hashPattern.test(pointer.databaseSha512) ||
      match[2] !== pointer.databaseSha512.slice(0, 16) ||
      match[3] !== pointer.installerSha512.slice(0, 16) ||
      typeof pointer.publishedAt !== "string" ||
      !Number.isFinite(Date.parse(pointer.publishedAt)) ||
      pointer.url !== `${origin.origin}/snapshots/${pointer.snapshotId}/tlnet`
    )
      throw new Error("Published CI mirror identity is invalid");
    date = calendarDate(pointer.canonicalDate);
    const age =
      (Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse(date)) /
      86400000;
    const lookback = Number(process.env.TEXLIVE_SNAPSHOT_LOOKBACK_DAYS ?? "14");
    if (
      !Number.isInteger(lookback) ||
      lookback < 1 ||
      lookback > 90 ||
      age < 0 ||
      age >= lookback
    )
      throw new Error("Published CI mirror date is outside the allowed window");
    snapshotId = pointer.snapshotId;
    expectedInstaller = pointer.installerSha512;
    expectedDatabase = pointer.databaseSha512;
  } else date = calendarDate(requested);
  const archive = new URL(
    process.env.TEXLIVE_ARCHIVE_ROOT ?? "https://texlive.info/tlnet-archive",
  );
  if (
    archive.protocol !== "https:" ||
    archive.username ||
    archive.password ||
    archive.search ||
    archive.hash
  )
    throw new Error(
      "Canonical archive must be an HTTPS URL without credentials",
    );
  const repository = `${archive.href.replace(/\/$/, "")}/${date.replaceAll("-", "/")}/tlnet`;
  const installer = checksum(
    await readSmall(
      `${repository}/install-tl-unx.tar.gz.sha512`,
      "Canonical installer identity",
    ),
    "install-tl-unx.tar.gz",
  );
  const database = checksum(
    await readSmall(
      `${repository}/tlpkg/texlive.tlpdb.sha512`,
      "Canonical database identity",
    ),
    "texlive.tlpdb",
  );
  if (
    (expectedInstaller !== undefined && installer !== expectedInstaller) ||
    (expectedDatabase !== undefined && database !== expectedDatabase)
  )
    throw new Error(
      "Published mirror identity differs from the canonical archive",
    );
  const output = `date=${date}\nrepository=${repository}\ninstaller_sha512=${installer}\ndatabase_sha512=${database}\nsnapshot_id=${snapshotId}\n`;
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, output);
  process.stdout.write(output);
}
try {
  await main();
} catch (error) {
  console.error(
    `texlive-snapshot: ${error instanceof Error ? error.message : "Invalid snapshot metadata"}`,
  );
  process.exitCode = 69;
}
