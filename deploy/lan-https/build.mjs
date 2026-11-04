import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  lstatSync,
  chmodSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { isMainModule } from "../scripts/is-main-module.mjs";

export function buildLanHttpsBinaries(source, version, commit) {
  if (
    source !== resolve(source) ||
    !/^\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/.test(version) ||
    !/^[a-f0-9]{40}$/.test(commit)
  )
    throw new Error("Invalid LAN HTTPS build identity");
  const root = join(source, "deploy/lan-https");
  const output = join(root, "bin");
  mkdirSync(output, { mode: 0o755 });
  if (readdirSync(output).length)
    throw new Error("LAN HTTPS output must be empty");
  const compiler = process.env.LAN_HTTPS_GO ?? "go";
  const compilerVersion = spawnSync(compiler, ["version"], {
    encoding: "utf8",
    timeout: 10000,
  });
  if (
    compilerVersion.status !== 0 ||
    !/\bgo1\.27\.3\b/.test(compilerVersion.stdout)
  )
    throw new Error("Pinned stable Go 1.27.3 is required");
  const binaries = {};
  for (const architecture of ["amd64", "arm64"]) {
    const name = `lan-https-linux-${architecture}`;
    const path = join(output, name);
    const result = spawnSync(
      compiler,
      [
        "build",
        "-p",
        "1",
        "-trimpath",
        "-buildvcs=false",
        "-ldflags",
        `-s -w -buildid= -X main.version=${version} -X main.sourceCommit=${commit}`,
        "-o",
        path,
        "./cmd/lan-https",
      ],
      {
        cwd: join(root, "bridge"),
        timeout: 180000,
        stdio: "pipe",
        env: {
          ...process.env,
          CGO_ENABLED: "0",
          GOOS: "linux",
          GOARCH: architecture,
          GOTOOLCHAIN: "local",
          GOPROXY: "off",
          GOSUMDB: "off",
          GOMAXPROCS: "1",
        },
      },
    );
    if (result.error || result.status !== 0)
      throw new Error("LAN HTTPS native build failed");
    chmodSync(path, 0o755);
    const file = lstatSync(path);
    if (!file.isFile() || file.nlink !== 1 || file.size > 20 * 1024 * 1024)
      throw new Error("Invalid LAN HTTPS build output");
    const data = readFileSync(path);
    binaries[architecture] = {
      path: `bin/${name}`,
      bytes: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
    };
  }
  writeFileSync(
    join(root, "binaries.json"),
    JSON.stringify({ format: 1, version, commit, binaries }, null, 2) + "\n",
    { mode: 0o644, flag: "wx" },
  );
  return Object.freeze({
    version,
    commit,
    architectures: Object.freeze(Object.keys(binaries)),
  });
}
if (isMainModule(import.meta.url)) {
  try {
    if (process.argv.length !== 5) throw new Error();
    buildLanHttpsBinaries(...process.argv.slice(2));
  } catch {
    process.stderr.write("LAN HTTPS binary assembly failed\n");
    process.exitCode = 1;
  }
}
