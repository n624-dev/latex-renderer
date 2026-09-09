import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { configureDockerRepository } from "./docker-repository.mjs";

if (
  process.getuid() !== 0 ||
  process.env.RUNNER_ENVIRONMENT !== "github-hosted" ||
  process.env.GITHUB_ACTIONS !== "true" ||
  !/^\d+$/.test(process.env.GITHUB_RUN_ID ?? "") ||
  !resolve(process.argv[1]).startsWith("/home/runner/work/")
)
  throw new Error(
    "Provisioning is restricted to a disposable GitHub-hosted release runner",
  );
for (const path of [
  "/etc/latex-renderer",
  "/opt/latex-renderer",
  "/var/lib/latex-renderer",
  "/etc/latex-renderer-ci-host.json",
]) {
  try {
    await access(path);
    throw new Error("Refusing to provision a nonempty application host");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const source = resolve(process.argv[1], "../../..");
const run = (program, args) =>
  execFileSync(program, args, { stdio: "inherit", timeout: 600_000 });
await writeFile(
  "/etc/latex-renderer-ci-host.json",
  JSON.stringify({
    runId: process.env.GITHUB_RUN_ID,
    bootId: (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(),
  }),
  { mode: 0o600, flag: "wx" },
);
run("/bin/sh", [resolve(source, "deploy/scripts/install-host.sh")]);
await configureDockerRepository(run);
run("/usr/bin/apt-get", [
  "install",
  "--no-install-recommends",
  "-y",
  "nginx",
  "docker-ce-rootless-extras",
]);
run("/bin/sh", ["-c", "command -v dockerd-rootless-setuptool.sh >/dev/null"]);
await mkdir("/etc/latex-renderer/ci", { mode: 0o700 });
const cert = "/usr/local/share/ca-certificates/latex-renderer-ci.crt";
run("/usr/bin/openssl", [
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-days",
  "2",
  "-subj",
  "/CN=latex.example.com",
  "-addext",
  "subjectAltName=DNS:latex.example.com",
  "-keyout",
  "/etc/latex-renderer/ci/tls.key",
  "-out",
  cert,
]);
run("/usr/sbin/update-ca-certificates", []);
await writeFile(
  "/etc/hosts",
  (await readFile("/etc/hosts", "utf8")) + "\n127.0.0.1 latex.example.com\n",
);
const proxy = (
  await readFile(
    resolve(source, "deploy/reverse-proxy/nginx.conf.example"),
    "utf8",
  )
)
  .replace("/etc/letsencrypt/live/latex.example.com/fullchain.pem", cert)
  .replace(
    "/etc/letsencrypt/live/latex.example.com/privkey.pem",
    "/etc/latex-renderer/ci/tls.key",
  );
await writeFile("/etc/nginx/conf.d/latex-renderer-ci.conf", proxy);
run("/usr/sbin/nginx", ["-t"]);
run("/usr/bin/systemctl", ["restart", "nginx"]);
await writeFile(
  "/etc/latex-renderer/renderer.env",
  (await readFile(resolve(source, ".env.example"), "utf8")) +
    `\nNODE_EXTRA_CA_CERTS=${cert}\n`,
  { mode: 0o640 },
);
run("/usr/bin/chown", [
  "root:latex-renderer",
  "/etc/latex-renderer/renderer.env",
]);
await writeFile(
  "/var/lib/latex-renderer/image-manager/state.json",
  JSON.stringify({
    version: 1,
    desired: {
      selector: { mode: "latest", value: null },
      languages: ["collection-langenglish", "collection-langjapanese"],
      autoUpdate: false,
    },
    current: null,
    previous: null,
  }),
  { mode: 0o640 },
);
console.log(
  "Disposable standalone/password/TLS host provisioned; no Cloudflare credentials used.",
);
