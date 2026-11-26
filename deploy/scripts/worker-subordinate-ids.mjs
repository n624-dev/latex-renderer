import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isMainModule } from "./is-main-module.mjs";

const count = 65_536;
const maxId = 4_294_967_294;

export function workerIdRange(contents, users, limits) {
  const { minimum, maximum } = limits;
  const ranges = contents.split(/\r?\n/).filter((line) => line.trim() !== "" && !line.trimStart().startsWith("#")).map((line) => {
    const match = /^([^:]+):(\d+):(\d+)$/.exec(line);
    if (!match) throw new Error("Malformed subordinate ID assignment");
    const first = Number(match[2]), length = Number(match[3]);
    const last = first + length - 1;
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(length) || first < 1 || length < 1 || last > maxId)
      throw new Error("Invalid subordinate ID assignment");
    return { owner: match[1], first, last };
  });
  const owned = ranges.filter((range) => users.includes(range.owner));
  if (owned.length > 0) {
    for (const range of owned) {
      if (ranges.some((other) => other !== range && range.first <= other.last && other.first <= range.last))
        throw new Error("The Worker subordinate ID assignment overlaps another range");
    }
    const first = owned[0];
    if (first.last - first.first + 1 < count)
      throw new Error("The existing Worker subordinate ID assignment is too small");
    return undefined;
  }
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) ||
      minimum < 1 || maximum > maxId || maximum - minimum + 1 < count)
    throw new Error("Host has no supported subordinate ID allocation range");
  let first = minimum;
  for (const range of ranges.sort((a, b) => a.first - b.first)) {
    if (range.last < first) continue;
    if (range.first - first >= count) break;
    first = range.last + 1;
  }
  const last = first + count - 1;
  if (last > maximum) throw new Error("No unallocated Worker subordinate ID range fits the host policy");
  return { first, last };
}

function configureWorkerIds() {
  if (process.getuid?.() !== 0) throw new Error("Worker ID allocation requires root");
  const worker = "latex-render-worker";
  const uid = execFileSync("/usr/bin/id", ["-u", worker], { encoding: "utf8" }).trim();
  const nss = readFileSync("/etc/nsswitch.conf", "utf8").match(/^subid\s*:\s*([^#\r\n]+)/m)?.[1].trim();
  if (nss !== undefined && nss !== "files")
    throw new Error("Validate Worker subordinate IDs in the host's configured subid provider before setup");
  const definitions = readFileSync("/etc/login.defs", "utf8");
  const args = [];
  const resolveRange = (suffix, name) => {
    const limit = (kind, baseline) => Number(definitions.match(new RegExp(`^\\s*SUB_${name}_${kind}\\s+(\\d+)\\b`, "m"))?.[1] ?? baseline);
    return workerIdRange(readFileSync(`/etc/sub${suffix}`, "utf8"), [worker, uid], {
      minimum: limit("MIN", 100_000),
      maximum: limit("MAX", 600_100_000),
    });
  };
  const files = [["uid", "UID"], ["gid", "GID"]];
  for (const [suffix, name] of files) {
    const range = resolveRange(suffix, name);
    if (range) args.push(`--add-sub${suffix}s`, `${range.first}-${range.last}`);
  }
  if (args.length > 0) execFileSync("/usr/sbin/usermod", [...args, worker], { stdio: "inherit" });
  if (files.some(([suffix, name]) => resolveRange(suffix, name)))
    throw new Error("Worker subordinate IDs were not assigned");
}

if (isMainModule(import.meta.url)) configureWorkerIds();
