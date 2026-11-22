#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  statfs,
  symlink,
} from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { acquireInheritedMutationLockForPath } from "./inherited-mutation-lock.mjs";

const root = "/opt/latex-renderer";
const current = join(root, "current");
const recovery = "/usr/local/libexec/latex-renderer-update-recovery.mjs";
const localNode = "/usr/local/bin/node";
const scriptRoot = fileURLToPath(new URL("../../", import.meta.url));
const bootstrapRoot = "/usr/lib/n624-latex/server";
const environment = {
  PATH: "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
  TERM: process.env.TERM ?? "dumb",
  LANG: "C.UTF-8",
};
const settings = "/etc/latex-renderer/renderer.env";
const database = "/var/lib/latex-renderer/renderer.sqlite3";
const initialJournal =
  "/etc/latex-renderer/installation-transaction/journal.json";
const dockerTools = [
  "/usr/bin/docker",
  "/usr/bin/dockerd-rootless-setuptool.sh",
];

function run(executable, args, options = {}) {
  return execFileSync(executable, args, {
    env: environment,
    stdio: "inherit",
    ...options,
  });
}
function read(executable, args) {
  return run(executable, args, {
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  }).trim();
}
async function optional(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
async function controlled(file) {
  const path = await realpath(file);
  const info = await lstat(path);
  if (!info.isFile() || info.uid !== 0 || info.mode & 0o022)
    throw new Error(`Untrusted system file: ${file}`);
  for (let parent = dirname(path); parent !== "/"; parent = dirname(parent)) {
    const info = await lstat(parent);
    if (!info.isDirectory() || info.uid !== 0 || info.mode & 0o022)
      throw new Error(`Untrusted system directory: ${parent}`);
  }
  return path;
}
async function secureDirectory(path, mode) {
  await mkdir(path, { mode }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.uid !== 0 ||
    info.mode & 0o022 ||
    (await realpath(path)) !== path
  )
    throw new Error(`Untrusted setup directory: ${path}`);
}

async function installedRelease() {
  const link = await optional(current);
  if (!link) return undefined;
  if (!link.isSymbolicLink() || link.uid !== 0)
    throw new Error("Invalid current release link");
  const path = await realpath(current);
  if (
    !/^\/opt\/latex-renderer\/releases\/v[0-9][a-z0-9.-]+-[a-f0-9]{12}$/.test(
      path,
    )
  )
    throw new Error("Invalid current release target");
  await controlled(join(path, "deploy/scripts/server-setup.mjs"));
  return path;
}

async function freshPreflight() {
  const os = await readFile("/etc/os-release", "utf8");
  const id = /^ID="?([a-z]+)"?$/m.exec(os)?.[1];
  const version = /^VERSION_ID="?([0-9.]+)"?$/m.exec(os)?.[1];
  if (
    !(id === "debian" && ["12", "13"].includes(version)) &&
    !(id === "ubuntu" && ["24.04", "26.04"].includes(version))
  )
    throw new Error(
      "Server setup supports Debian 12/13 and Ubuntu 24.04/26.04",
    );
  if (
    !["x64", "arm64"].includes(process.arch) ||
    !(await optional("/run/systemd/system"))
  )
    throw new Error("Server setup requires systemd on amd64 or arm64");
  for (const path of ["/opt", "/var/lib"]) {
    const { bsize, bavail } = await statfs(path, { bigint: true });
    if (bsize * bavail < 5n * 1024n ** 3n)
      throw new Error(`Server setup requires at least 5 GiB free on ${path}`);
  }
  for (const path of dockerTools) {
    if (!(await optional(path))) return false;
    await controlled(path);
  }
  return true;
}

async function writeState(path, state) {
  const temporary = `${path}.next`;
  const previous = await optional(temporary);
  if (previous) {
    if (!previous.isFile() || previous.uid !== 0 || previous.mode & 0o077)
      throw new Error("Invalid interrupted setup state");
    await rm(temporary);
  }
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(state) + "\n");
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
  const dir = await open(dirname(path), "r");
  try {
    await dir.sync();
  } finally {
    await dir.close();
  }
}

async function readState(path) {
  if (!(await optional(path))) return undefined;
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.uid !== 0 ||
      info.nlink !== 1 ||
      info.mode & 0o077 ||
      info.size > 8192
    )
      throw new Error("Invalid server setup state");
    return JSON.parse(await file.readFile({ encoding: "utf8" }));
  } finally {
    await file.close();
  }
}

async function ensureLocalRuntime() {
  if (
    (await optional(localNode)) &&
    (await optional("/usr/local/bin/corepack"))
  ) {
    const version = read(await controlled(localNode), ["--version"]);
    if (!/^v(?:24|26)\./.test(version))
      throw new Error("The existing service Node.js is incompatible");
    await controlled("/usr/local/bin/corepack");
    return;
  }
  const library = "/usr/lib/n624-latex/runtime";
  const target = join(root, "host-runtime");
  await secureDirectory(target, 0o755);
  await secureDirectory(join(target, "bin"), 0o755);
  await controlled(join(library, "bin/node"));
  await controlled(join(library, "corepack/dist/corepack.js"));
  for (const file of ["bin/node", "corepack"]) {
    // Retain an existing trusted copy on a retry. The server runtime remains
    // independent of whether the APT client is subsequently removed.
    if (!(await optional(join(target, file)))) {
      const stage = await mkdtemp(join(target, ".copy-"));
      try {
        await cp(join(library, file), join(stage, "payload"), {
          recursive: true,
        });
        await rename(join(stage, "payload"), join(target, file));
      } finally {
        await rm(stage, { recursive: true, force: true });
      }
    }
  }
  for (const [path, relative] of [
    [localNode, "bin/node"],
    ["/usr/local/bin/corepack", "corepack/dist/corepack.js"],
  ]) {
    if (!(await optional(path)))
      await symlink(await controlled(join(target, relative)), path);
  }
  if (!/^v(?:24|26)\./.test(read(await controlled(localNode), ["--version"])))
    throw new Error("The service Node.js is incompatible");
  await controlled("/usr/local/bin/corepack");
}

async function initialise(identity, version) {
  // The signed release is extracted and built before selecting a current slot.
  // Building uses the invoking non-root account, just as in the Updater.
  await secureDirectory(root, 0o755);
  await secureDirectory(join(root, "update-staging"), 0o711);
  await secureDirectory(join(root, "releases"), 0o755);
  const staging = join(root, "update-staging");
  const lock = await acquireInheritedMutationLockForPath(
    join(staging, "n624-initial-setup.lock"),
  );
  const journal = join(staging, "n624-initial-setup.json");
  let work;
  try {
    if (
      (await optional(current)) ||
      (await optional(settings)) ||
      (await optional(database))
    )
      throw new Error(
        "Installation state changed while acquiring the setup lock. Rerun setup.",
      );
    const previous = await readState(journal);
    if (
      previous &&
      (previous.version !== version || previous.user !== identity.deployUser)
    )
      throw new Error(
        "Rerun setup with the original release package and deployment account",
      );
    const device = (await lstat(staging)).dev;
    for (const name of await readdir(staging)) {
      if (!/^n624-initial-[A-Za-z0-9]{6}$/.test(name)) continue;
      const path = join(staging, name);
      const entry = await lstat(path);
      if (
        !entry.isDirectory() ||
        entry.uid !== 0 ||
        entry.dev !== device ||
        entry.mode & 0o022
      )
        throw new Error("Unsafe interrupted setup directory");
      await rm(path, { recursive: true });
    }
    await writeState(journal, { version, user: identity.deployUser });
    work = await mkdtemp(join(staging, "n624-initial-"));
    const { downloadPublishedRelease } =
      await import("./published-release.mjs");
    run("/bin/sh", [
      await controlled(
        join(bootstrapRoot, "deploy/scripts/install-github-cli.sh"),
      ),
    ]);
    const release = await downloadPublishedRelease(version, work);
    const script = (name) => join(release.source, "deploy/scripts", name);
    if (!(await optional(script("n624-latex-server.mjs")))) {
      throw new Error(
        "The published release does not support this setup command. Install its matching APT package.",
      );
    }
    const helper = await import(
      pathToFileURL(script("update-manager-helper.mjs")).href
    );
    const manifest = await helper.verifyExtractedRelease(
      { ...release, tag: `v${release.version}` },
      release.source,
    );
    await ensureLocalRuntime();

    run("/bin/sh", [script("install-host.sh")], {
      env: { ...environment, SUDO_USER: identity.deployUser },
      stdio: ["inherit", "inherit", "inherit", lock.fd],
    });
    run("/bin/sh", [script("configure-rootless-docker.sh")], {
      stdio: ["inherit", "inherit", "inherit", lock.fd],
    });

    const assembly = await helper.buildBootstrapRelease(
      work,
      release.source,
      manifest.packageManager,
      identity,
      lock.fd,
    );
    const { publishRelease } = await import(
      pathToFileURL(script("release-publication.mjs")).href
    );
    const id = `v${release.version}-${manifest.commit.slice(0, 12)}`;
    const gid = Number(
      read("/usr/bin/getent", ["group", "latex-renderer"]).split(":")[2],
    );
    if (!Number.isSafeInteger(gid) || gid <= 0)
      throw new Error("Invalid application group");
    await publishRelease({
      source: assembly,
      releaseId: id,
      releasesRoot: join(root, "releases"),
      journalRoot: join(staging, "release-publications"),
      gid,
    });
    const path = join(root, "releases", id);
    await symlink(path, current);
    const directory = await open(root, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return path;
  } finally {
    try {
      if (work) await rm(work, { recursive: true, force: true });
    } finally {
      await lock.release();
    }
  }
}

async function main() {
  if (process.platform !== "linux" || process.geteuid?.() !== 0)
    throw new Error(
      "Run server commands from the system installation with sudo on Debian or Ubuntu",
    );
  const args = process.argv.slice(2);
  if (args.join(" ") === "recovery status") {
    run(await controlled(localNode), [await controlled(recovery), "status"]);
    return;
  }
  if (
    args[0] !== "setup" ||
    args
      .slice(1)
      .some(
        (value) => !["--web", "--cui", "--ingress", "--plan"].includes(value),
      ) ||
    (args.includes("--web") && args.includes("--cui"))
  )
    throw new Error(
      "Usage: n624-latex server setup [--web|--cui] [--ingress] [--plan] | server recovery status",
    );
  const plan = args.includes("--plan");
  const external = args.includes("--ingress");
  const web = args.includes("--web");
  const shell = args.includes("--cui");
  let release = await installedRelease();
  const pending = Boolean(await optional(initialJournal));
  const configured = Boolean(await optional(settings));
  const hasDb = Boolean(await optional(database));
  let scope = external ? "--ingress" : configured ? "--existing" : "--initial";
  if (!release && (configured || hasDb || external || pending))
    throw new Error(
      "Found an existing installation without a valid release. Inspect recovery state first.",
    );
  if (!configured && hasDb && !pending)
    throw new Error(
      "Found an existing database. Inspect recovery state before setup.",
    );
  if (external && !configured)
    throw new Error("HTTPS reconfiguration requires an existing installation");
  if (pending && release) {
    const { ServerInstallStore } = await import(
      pathToFileURL(
        await controlled(
          join(release, "deploy/scripts/server-install-store.mjs"),
        ),
      ).href
    );
    const names = [
      "environment",
      "certificate",
      "privateKey",
      "nginx",
      "oidcSecret",
      "updateEnv",
      "lanConfig",
      "lanInvitation",
    ];
    const journal = await new ServerInstallStore(
      dirname(initialJournal),
      Object.fromEntries(names.map((name) => [name, null])),
    ).journal();
    if (journal) {
      scope = journal.kind === "initial" ? "--initial" : "--ingress";
      if (external && scope !== "--ingress")
        throw new Error(
          "Complete initial setup recovery before changing HTTPS",
        );
    }
  }
  const dockerReady = release || (await freshPreflight());
  if (plan) {
    console.log(
      release
        ? `Open the managed setup wizard (${scope.slice(2)})`
        : "Prepare verified release, dedicated users, rootless Docker and local services",
    );
    if (!dockerReady)
      console.log(
        "Prerequisite: install Docker Engine with its rootless extras",
      );
    return;
  }
  if (!dockerReady)
    throw new Error(
      "Install Docker Engine with its rootless extras, then rerun n624-latex server setup",
    );
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(
      "Server setup uses an interactive terminal. Use --plan to inspect the mode.",
    );
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let frontend;
  try {
    frontend = web
      ? "--web"
      : shell
        ? "--cui"
        : (
              await prompt.question(
                "Setup interface: 1 terminal / 2 browser [1]: ",
              )
            ).trim() === "2"
          ? "--web"
          : "--cui";
    if (!release) {
      if (scriptRoot.replace(/\/$/, "") !== bootstrapRoot)
        throw new Error(
          "Install the signed n624-latex APT package for fresh-host provisioning",
        );
      const deployUser = process.env.SUDO_USER;
      if (
        !deployUser ||
        !/^[a-z_][a-z0-9_-]{0,31}$/.test(deployUser) ||
        deployUser === "root"
      )
        throw new Error(
          "Start setup via sudo from a non-root deployment account",
        );
      const uid = read("/usr/bin/id", ["-u", deployUser]);
      const gid = read("/usr/bin/id", ["-g", deployUser]);
      if (!/^[1-9]\d*$/.test(uid) || !/^[1-9]\d*$/.test(gid))
        throw new Error("Invalid deployment account");
      const version = read("/usr/bin/dpkg-query", [
        "-W",
        "-f=${Version}",
        "n624-latex",
      ]);
      if (!/^\d+\.\d+\.\d+$/.test(version))
        throw new Error(
          "Use a published Stable APT package for fresh-host setup",
        );
      console.log(
        `Prepare signed application v${version}, required system packages, service Node.js paths, dedicated users and rootless Docker.`,
      );
      if (
        (await prompt.question("Type PREPARE to apply: ")).trim() !== "PREPARE"
      )
        return;
      release = await initialise({ uid, gid, deployUser }, version);
      scope = "--initial";
    }
  } finally {
    prompt.close();
  }
  const node = await controlled(localNode);
  const scripts = join(release, "deploy/scripts");
  const env = {
    ...environment,
    UPDATE_DEPLOY_USER: process.env.SUDO_USER ?? "",
  };
  if (scope === "--initial" && !pending) {
    run("/bin/sh", [
      await controlled(join(scripts, "configure-rootless-docker.sh")),
    ]);
    run(node, [
      "--input-type=module",
      "-e",
      "import(process.argv[1]).then((value) => value.prepareServerApplication())",
      pathToFileURL(await controlled(join(scripts, "server-setup-prepare.mjs")))
        .href,
    ]);
    console.log(
      "Preparing and validating the first TeX Runtime. This can take several minutes.",
    );
    env.N624_INITIAL_RUNTIME = read(node, [
      await controlled(join(scripts, "image-manager.mjs")),
      "--prepare-initial-runtime",
    ]);
    if (!/^sha256:[a-f0-9]{64}$/.test(env.N624_INITIAL_RUNTIME))
      throw new Error("Invalid prepared TeX Runtime identity");
  }
  run(
    node,
    [await controlled(join(scripts, "server-setup.mjs")), frontend, scope],
    { env },
  );
  if (
    (await optional(settings)) &&
    (await optional(database)) &&
    !(await optional(initialJournal))
  ) {
    const launcherInstaller = join(scripts, "install-n624-latex.sh");
    if (await optional(launcherInstaller)) {
      run("/bin/sh", [await controlled(launcherInstaller)]);
    }
    await rm(join(root, "update-staging", "n624-initial-setup.json"), {
      force: true,
    });
  }
}

try {
  await main();
} catch (error) {
  console.error(`n624-latex: ${error.message}`);
  process.exitCode = 1;
}
