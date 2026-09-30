import { execFileSync } from "node:child_process";
import { appendFileSync, lstatSync, readdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Supplied by the GitHub-hosted Windows 2025 image, not a mutable installer URL.
export const WINDOWS_OPENSSL_VERSION = "3.6.4";

export function selectRunnerOpenSSL(programFiles, run = runOpenSSL) {
  if (
    typeof programFiles !== "string" ||
    !isAbsolute(programFiles) ||
    /[\r\n]/u.test(programFiles)
  )
    throw new Error("A valid absolute ProgramFiles directory is required");
  const installations = readdirSync(programFiles, { withFileTypes: true })
    .filter((entry) => /^OpenSSL(?:-Win64)?$/iu.test(entry.name) && entry.isDirectory());
  if (installations.length !== 1)
    throw new Error("Expected exactly one runner-provided OpenSSL installation");
  const directory = join(programFiles, installations[0].name, "bin");
  const executable = join(directory, "openssl.exe");
  if (!lstatSync(directory).isDirectory() || !lstatSync(executable).isFile())
    throw new Error("Runner OpenSSL must be a regular executable in its own bin directory");
  const version = run(executable, ["version"]).trim();
  if (!version.startsWith(`OpenSSL ${WINDOWS_OPENSSL_VERSION} `))
    throw new Error(`Expected OpenSSL ${WINDOWS_OPENSSL_VERSION} but found ${version}`);
  const commands = new Set(run(executable, ["list", "-commands"]).split(/\s+/u));
  for (const command of ["cms", "req", "x509"])
    if (!commands.has(command))
      throw new Error(`Runner OpenSSL does not provide ${command}`);
  return { directory, executable, version };
}

function runOpenSSL(executable, args) {
  return execFileSync(executable, args, { encoding: "utf8", timeout: 10_000 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== "win32")
    throw new Error("Runner OpenSSL selection is Windows-only");
  if (!process.env.GITHUB_PATH)
    throw new Error("GITHUB_PATH is required before selecting OpenSSL");
  const selected = selectRunnerOpenSSL(process.env.ProgramFiles);
  appendFileSync(process.env.GITHUB_PATH, `${selected.directory}\n`, "utf8");
  process.stdout.write(`Using ${selected.version} at ${selected.executable}\n`);
}
