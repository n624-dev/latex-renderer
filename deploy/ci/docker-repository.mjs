import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";

// Called only after provision-update-host's disposable-host checks. Never used
// by the production installer. Keep the repository scoped to its own keyring.
export async function configureDockerRepository(run) {
  const release = await readFile("/etc/os-release", "utf8");
  if (
    !/^ID=(?:ubuntu|"ubuntu")$/m.test(release) ||
    !/^VERSION_CODENAME=(?:noble|"noble")$/m.test(release) ||
    process.arch !== "x64"
  )
    throw new Error("Release E2E requires an Ubuntu 24.04 amd64 runner");

  await mkdir("/etc/apt/keyrings", { recursive: true, mode: 0o755 });
  run("/usr/bin/curl", [
    "--fail",
    "--silent",
    "--show-error",
    "--location",
    "--proto",
    "=https",
    "--proto-redir",
    "=https",
    "--max-time",
    "60",
    "--retry",
    "2",
    "--output",
    "/etc/apt/keyrings/latex-renderer-ci-docker.asc",
    "https://download.docker.com/linux/ubuntu/gpg",
  ]);
  await chmod("/etc/apt/keyrings/latex-renderer-ci-docker.asc", 0o644);
  await writeFile(
    "/etc/apt/sources.list.d/latex-renderer-ci-docker.sources",
    "Types: deb\n" +
      "URIs: https://download.docker.com/linux/ubuntu\n" +
      "Suites: noble\n" +
      "Components: stable\n" +
      "Architectures: amd64\n" +
      "Signed-By: /etc/apt/keyrings/latex-renderer-ci-docker.asc\n",
    { mode: 0o644, flag: "wx" },
  );
  run("/usr/bin/apt-get", ["update"]);
}
