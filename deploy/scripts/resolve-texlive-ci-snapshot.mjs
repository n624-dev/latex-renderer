#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { URL } from "node:url";

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

function readSmall(url, label) {
  try {
    return execFileSync(
      "curl",
      [
        "--fail",
        "--silent",
        "--show-error",
        "--proto",
        "=https",
        "--retry",
        "3",
        "--retry-delay",
        "2",
        "--connect-timeout",
        process.env.TEXLIVE_CURL_CONNECT_TIMEOUT_SECONDS ?? "10",
        "--max-time",
        process.env.TEXLIVE_CURL_MAX_TIME_SECONDS ?? "60",
        "--max-filesize",
        "65536",
        url,
      ],
      {
        encoding: "utf8",
        maxBuffer: 65536,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 2_500_000,
      },
    );
  } catch (error) {
    const code =
      typeof error?.status === "number" ? error.status : "unavailable";
    // Do not echo a private hostname, request arguments, service credentials,
    // curl's untrusted body, or an entire child_process exception.
    throw new Error(
      `${label} request failed (curl ${code}); refusing to select another date`,
      { cause: error },
    );
  }
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

function main() {
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
    const pointerText = readSmall(
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
    readSmall(
      `${repository}/install-tl-unx.tar.gz.sha512`,
      "Canonical installer identity",
    ),
    "install-tl-unx.tar.gz",
  );
  const database = checksum(
    readSmall(
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
  main();
} catch (error) {
  console.error(
    `texlive-snapshot: ${error instanceof Error ? error.message : "Invalid snapshot metadata"}`,
  );
  process.exitCode = 69;
}
