import { spawn } from "node:child_process";

export async function validateReleaseArchive({
  bundle,
  topLevel,
  maxEntries,
  maxExpandedBytes,
  maxExpandedFileBytes,
  maxPathBytes = 512,
  maxListingBytes = 32 * 1024 * 1024,
}) {
  const listing = await capture("tar", ["-tzf", bundle], maxListingBytes);
  const verboseListing = await capture(
    "tar",
    [
      "-tvzf",
      bundle,
      "--numeric-owner",
      "--full-time",
      "--quoting-style=c",
    ],
    maxListingBytes,
    { ...process.env, LC_ALL: "C" },
  );
  const prefix = `${topLevel}/`;
  const entries = listing.split(/\r?\n/).filter(Boolean);
  if (entries.length === 0) throw new Error("Release bundle is empty");
  if (entries.length > maxEntries)
    throw new Error("Release bundle contains too many entries");
  const uniqueEntries = new Set();
  for (const entry of entries) {
    if (
      !entry.startsWith(prefix) ||
      entry.startsWith("/") ||
      entry.split("/").includes("..") ||
      Buffer.byteLength(entry) > maxPathBytes
    )
      throw new Error(
        "Release bundle contains a path outside its versioned top-level directory",
      );
    if (uniqueEntries.has(entry))
      throw new Error("Release bundle contains duplicate paths");
    uniqueEntries.add(entry);
  }
  const verboseEntries = verboseListing.split(/\r?\n/).filter(Boolean);
  if (verboseEntries.length !== entries.length)
    throw new Error("Release bundle listings are inconsistent");
  let expandedBytes = 0;
  for (const entry of verboseEntries) {
    if (entry[0] !== "-" && entry[0] !== "d")
      throw new Error(
        "Release bundle may contain only regular files and directories",
      );
    const fields = entry.trimStart().split(/\s+/, 6);
    const size = Number(fields[2]);
    if (!/^\d+$/.test(fields[2] ?? "") || !Number.isSafeInteger(size))
      throw new Error("Release bundle contains an invalid expanded file size");
    if (size > maxExpandedFileBytes)
      throw new Error("Release bundle contains an oversized expanded file");
    expandedBytes += size;
    if (!Number.isSafeInteger(expandedBytes) || expandedBytes > maxExpandedBytes)
      throw new Error("Release bundle exceeds the expanded size limit");
  }
}

function capture(command, args, maximum, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = [];
    const errors = [];
    let bytes = 0;
    let limitError;
    const collect = (target, chunk) => {
      if (limitError) return;
      bytes += chunk.length;
      if (bytes > maximum) {
        limitError = new Error("Release archive listing exceeds its size limit");
        child.kill("SIGKILL");
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", (chunk) => collect(output, chunk));
    child.stderr.on("data", (chunk) => collect(errors, chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (limitError) return reject(limitError);
      if (code !== 0)
        return reject(
          new Error(
            `tar exited ${code}: ${Buffer.concat(errors).toString("utf8").slice(0, 4096)}`,
          ),
        );
      resolve(Buffer.concat(output).toString("utf8"));
    });
  });
}
