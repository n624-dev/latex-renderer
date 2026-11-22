#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { URL } from "node:url";
import { gzipSync } from "node:zlib";

const [input, output, origin] = process.argv.slice(2);
const fingerprint = process.env.N624_APT_FINGERPRINT;
const originUrl = origin === undefined ? undefined : new URL(origin);
if (
  !input ||
  !output ||
  !origin ||
  process.argv.length !== 5 ||
  !/^https:\/\/[a-z0-9.-]+(?:\/[a-zA-Z0-9_.-]+)*\/?$/.test(origin) ||
  originUrl?.href.replace(/\/$/, "") !== origin.replace(/\/$/, "") ||
  !/^(?:[A-F0-9]{40}|[A-F0-9]{64})$/.test(fingerprint ?? "")
)
  throw new Error(
    "Usage: N624_APT_FINGERPRINT=... build-repository.mjs PACKAGE_DIRECTORY OUTPUT HTTPS_ORIGIN",
  );
const command = (bin, args, cwd = process.cwd()) =>
  execFileSync(bin, args, { cwd, encoding: "utf8", maxBuffer: 4 * 1024 ** 2 });
const destination = resolve(output);
await mkdir(dirname(destination), { recursive: true });
const stage = await mkdtemp(join(dirname(destination), ".n624-apt-"));
try {
  const pool = join(stage, "pool");
  const suite = join(stage, "dists/stable");
  await mkdir(pool);
  const files = await readdir(input);
  if (!files.length || files.length > 6)
    throw new Error("Expected at most three releases for two architectures");
  const arches = ["amd64", "arm64"];
  const entries = new Map(arches.map((arch) => [arch, []]));
  const versions = new Map();
  let releaseBytes = 0;
  for (const file of files.sort()) {
    const match = /^n624-latex_(\d+\.\d+\.\d+)_(amd64|arm64)\.deb$/.exec(file);
    if (!match) throw new Error(`Unexpected APT package: ${file}`);
    const architectures = versions.get(match[1]) ?? new Set();
    architectures.add(match[2]);
    versions.set(match[1], architectures);
    const source = resolve(input, file);
    const info = await lstat(source);
    if (!info.isFile() || info.size > 90 * 1024 ** 2)
      throw new Error("Invalid or oversized APT package");
    releaseBytes += info.size;
    if (releaseBytes > 600 * 1024 ** 2)
      throw new Error("APT archive exceeds the Pages release budget");
    const [name, version, architecture] = command("dpkg-deb", [
      "--show",
      "--showformat=${Package} ${Version} ${Architecture}",
      source,
    ]).split(" ");
    if (
      name !== "n624-latex" ||
      version !== match[1] ||
      architecture !== match[2]
    )
      throw new Error(`Invalid APT metadata: ${file}`);
    await cp(source, join(pool, file), { errorOnExist: true, force: false });
  }
  if ([...versions.values()].some(({ size }) => size !== arches.length))
    throw new Error("Every release must include both architectures");
  const index = command("apt-ftparchive", ["packages", "pool"], stage);
  for (const record of index.trim().split(/\n\n+/)) {
    const match = /^Architecture: (amd64|arm64)$/m.exec(record);
    const archEntries = match && entries.get(match[1]);
    if (!archEntries)
      throw new Error("APT index contains an unexpected package");
    archEntries.push(record);
  }
  for (const arch of arches) {
    const records = entries.get(arch);
    if (records.length === 0) throw new Error(`APT index is missing ${arch}`);
    const directory = join(suite, "main", `binary-${arch}`);
    await mkdir(directory, { recursive: true });
    const payload = Buffer.from(records.join("\n\n") + "\n\n");
    for (const [name, value] of [
      ["Packages", payload],
      ["Packages.gz", gzipSync(payload)],
    ]) {
      const indexFile = join(directory, name);
      await writeFile(indexFile, value);
      for (const algorithm of ["SHA256", "SHA512"]) {
        const hash = createHash(algorithm.toLowerCase())
          .update(value)
          .digest("hex");
        const hashes = join(directory, "by-hash", algorithm);
        await mkdir(hashes, { recursive: true });
        // GitHub Pages artifacts require independent files.
        await writeFile(join(hashes, hash), value);
      }
    }
  }
  const release = command("apt-ftparchive", ["release", "."], suite);
  const policy =
    "Origin: n624-dev\nLabel: n624-latex\nSuite: stable\nCodename: stable\nArchitectures: amd64 arm64\nComponents: main\nAcquire-By-Hash: yes\n";
  await writeFile(join(suite, "Release"), policy + release);
  const gpg = ["--batch", "--no-tty", "--local-user", fingerprint];
  execFileSync("gpg", [
    ...gpg,
    "--output",
    join(suite, "InRelease"),
    "--clearsign",
    join(suite, "Release"),
  ]);
  execFileSync("gpg", [
    ...gpg,
    "--armor",
    "--output",
    join(suite, "Release.gpg"),
    "--detach-sign",
    join(suite, "Release"),
  ]);
  const key = command("gpg", [
    "--batch",
    "--armor",
    "--export",
    fingerprint,
  ]).trim();
  if (!key.startsWith("-----BEGIN PGP PUBLIC KEY BLOCK-----"))
    throw new Error("Could not export the APT signing public key");
  const sources = [
    "Types: deb",
    `URIs: ${origin.replace(/\/$/, "")}`,
    "Suites: stable",
    "Components: main",
    "Architectures: amd64 arm64",
    "Signed-By:",
    ...key.split("\n").map((line) => " " + (line || ".")),
    "",
  ].join("\n");
  await writeFile(join(stage, "n624-latex.sources"), sources);
  await writeFile(join(stage, ".nojekyll"), "");
  await writeFile(
    join(stage, "index.html"),
    '<!doctype html><meta charset="utf-8"><title>n624-latex APT repository</title><a href="n624-latex.sources">APT repository source file</a>\n',
  );
  await rename(stage, destination);
} finally {
  await rm(stage, { recursive: true, force: true });
}
