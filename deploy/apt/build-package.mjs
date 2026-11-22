#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

const repository = fileURLToPath(new URL("../../", import.meta.url));
process.umask(0o022);
const [architecture, destination] = process.argv.slice(2);
const cpu = { amd64: "x64", arm64: "arm64" }[architecture];
if (!cpu || !destination || process.argv.length !== 4)
  throw new Error("Usage: build-package.mjs amd64|arm64 OUTPUT_DIRECTORY");
const version = JSON.parse(
  await readFile(join(repository, "package.json")),
).version;
if (
  typeof version !== "string" ||
  !/^\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/.test(version)
)
  throw new Error("Unsupported package version");
const packageVersion = version.replace("-rc.", "~rc.");
const runtime = JSON.parse(
  await readFile(new URL("./node-runtime.json", import.meta.url)),
);
const nodeName = `node-v${runtime.version}-linux-${cpu}`;
const archiveName = `${nodeName}.tar.xz`;
const work = await mkdtemp(join(tmpdir(), "n624-latex-deb-"));
const output = resolve(destination);
try {
  const archive = join(work, archiveName);
  execFileSync(
    "curl",
    [
      "--fail",
      "--silent",
      "--show-error",
      "--location",
      "--proto",
      "=https",
      "--proto-redir",
      "=https",
      "--max-time",
      "180",
      "--max-filesize",
      "83886080",
      "--output",
      archive,
      `https://nodejs.org/dist/v${runtime.version}/${archiveName}`,
    ],
    { stdio: "inherit" },
  );
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  if (hash.digest("hex") !== runtime.sha256[architecture])
    throw new Error("Node.js archive failed the pinned SHA-256 check");

  const packageRoot = join(work, "package");
  const library = join(packageRoot, "usr/lib/n624-latex");
  const executable = join(packageRoot, "usr/bin");
  await mkdir(join(library, "runtime"), { recursive: true, mode: 0o755 });
  await mkdir(executable, { recursive: true, mode: 0o755 });
  await mkdir(join(packageRoot, "DEBIAN"), { mode: 0o755 });
  execFileSync("tar", [
    "-xJf",
    archive,
    "--strip-components=1",
    "--no-same-owner",
    "-C",
    join(library, "runtime"),
    `${nodeName}/bin/node`,
    `${nodeName}/LICENSE`,
  ]);
  const corepack = join(work, "corepack.tgz");
  execFileSync("curl", [
    "--fail",
    "--silent",
    "--show-error",
    "--proto",
    "=https",
    "--max-time",
    "60",
    "--max-filesize",
    "8388608",
    "--output",
    corepack,
    `https://registry.npmjs.org/corepack/-/corepack-${runtime.corepack.version}.tgz`,
  ]);
  if (
    createHash("sha512")
      .update(await readFile(corepack))
      .digest("base64") !== runtime.corepack.sha512
  )
    throw new Error("Corepack archive failed the pinned SHA-512 check");
  const corepackRoot = join(library, "runtime/corepack");
  await mkdir(corepackRoot, { mode: 0o755 });
  execFileSync("tar", [
    "-xzf",
    corepack,
    "--strip-components=1",
    "--no-same-owner",
    "-C",
    corepackRoot,
  ]);
  await cp(
    join(repository, "client-dist/latex-renderer-client"),
    join(library, "client"),
    { recursive: true },
  );
  const server = join(library, "server");
  for (const name of [
    "n624-latex-server.mjs",
    "published-release.mjs",
    "release-attestation.mjs",
    "release-version.mjs",
    "release-archive.mjs",
    "install-github-cli.sh",
    "inherited-mutation-lock.mjs",
  ]) {
    const path = join(server, "deploy/scripts", name);
    await mkdir(join(server, "deploy/scripts"), { recursive: true });
    await cp(join(repository, "deploy/scripts", name), path);
  }
  await cp(
    join(repository, "deploy/apt/node-runtime.json"),
    join(server, "node-runtime.json"),
  );
  for (const name of [
    "n624-latex",
    "latex-render",
    "latex-render-admin",
    "latex-renderer-mcp",
  ]) {
    const path = join(executable, name);
    await cp(join(repository, "deploy/apt/launcher.sh"), path);
    await chmod(path, 0o755);
  }
  const installedSize = execFileSync(
    "du",
    ["--apparent-size", "-sk", library],
    {
      encoding: "utf8",
    },
  )
    .trim()
    .split(/\s+/)[0];
  await writeFile(
    join(packageRoot, "DEBIAN/control"),
    [
      "Package: n624-latex",
      `Version: ${packageVersion}`,
      `Architecture: ${architecture}`,
      "Maintainer: n624-dev <n624-dev@users.noreply.github.com>",
      "Section: tex",
      "Priority: optional",
      `Installed-Size: ${installedSize}`,
      "Depends: ca-certificates, curl, libc6 (>= 2.28), libatomic1, libgcc-s1, libstdc++6",
      "Homepage: https://github.com/n624-dev/latex-renderer",
      "Description: LaTeX Renderer client and server setup launcher",
      " Compile documents remotely and configure a local LaTeX Renderer server.",
      "",
    ].join("\n"),
  );
  await mkdir(output, { recursive: true });
  execFileSync(
    "dpkg-deb",
    [
      "--root-owner-group",
      "-Zxz",
      "-z3",
      "--build",
      packageRoot,
      join(output, `n624-latex_${packageVersion}_${architecture}.deb`),
    ],
    { stdio: "inherit" },
  );
} finally {
  await rm(work, { recursive: true, force: true });
}
