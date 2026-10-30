import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

export async function verifyCredentialStartup(candidate, root) {
  assert.equal(process.getuid(), 0);
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
  const markerPath = "/etc/latex-renderer-ci-host.json";
  const info = await lstat(markerPath);
  assert(info.isFile() && info.uid === 0 && !(info.mode & 0o077));
  const marker = JSON.parse(await readFile(markerPath, "utf8"));
  assert.equal(marker.runId, process.env.GITHUB_RUN_ID);
  assert.equal(
    marker.bootId,
    (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(),
  );
  const unit = await readFile(
    join(candidate, "deploy/systemd/latex-renderer-image-manager.service"),
    "utf8",
  );
  assert.match(unit, /^Type=exec$/m);
  assert.match(unit, /^LoadCredential=image-manager-token:/m);
  assert.match(unit, /^ExecStartPost=.*wait-image-manager-http.sh$/m);
  const credential = join(root, "startup-credential");
  await writeFile(credential, "synthetic-ci-credential\n", {
    mode: 0o400,
    flag: "wx",
  });
  const protections = unit
    .split("\n")
    .filter((line) =>
      /^(ProtectSystem|ProtectHome|PrivateDevices|ProtectKernelTunables|ProtectKernelModules|ProtectControlGroups|RestrictSUIDSGID|LockPersonality|RestrictAddressFamilies)=/.test(
        line,
      ),
    );
  assert(protections.includes("RestrictSUIDSGID=true"));
  const suffix = randomBytes(6).toString("hex");
  const cliCwd = join(root, "cli-empty-cwd");
  await mkdir(cliCwd, { mode: 0o700 });
  // Exact setup script, real gh version/help, same HOME-unset service boundary.
  execFileSync(
    "/usr/bin/systemd-run",
    [
      "--quiet",
      "--wait",
      "--pipe",
      "--collect",
      `--unit=latex-renderer-ci-gh-probes-${suffix}`,
      "--service-type=exec",
      `--property=WorkingDirectory=${cliCwd}`,
      "--property=RuntimeMaxSec=2min",
      "--property=TimeoutStopSec=10s",
      "/usr/bin/env",
      "-i",
      "PATH=/usr/local/bin:/usr/bin:/bin",
      "/bin/sh",
      join(candidate, "deploy/scripts/install-github-cli.sh"),
    ],
    { stdio: "pipe", timeout: 150000 },
  );
  assert.deepEqual(await readdir(cliCwd), []);
  console.log(
    JSON.stringify({
      event: "github_cli.clean_source_probe.passed",
      homeAbsent: true,
      sourceUnchanged: true,
    }),
  );
  for (let attempt = 0; attempt < 5; attempt++) {
    const unit = `latex-renderer-ci-credentials-${suffix}-${attempt}.service`;
    execFileSync(
      "/usr/bin/systemd-run",
      [
        "--quiet",
        "--wait",
        "--pipe",
        "--collect",
        `--unit=${unit}`,
        "--service-type=exec",
        "--property=User=root",
        "--property=Group=latex-renderer",
        "--property=RuntimeMaxSec=10s",
        "--property=TimeoutStartSec=15s",
        "--property=TimeoutStopSec=5s",
        `--property=LoadCredential=fixture:${credential}`,
        "--property=ExecStartPre=/bin/sleep 0.05",
        // Transient ExecStartPost properties retain %d literally (unlike unit files).
        `--property=ExecStartPost=/usr/bin/test -s /run/credentials/${unit}/fixture`,
        ...protections.map((line) => `--property=${line}`),
        "/bin/sh",
        "-c",
        'test -s "$CREDENTIALS_DIRECTORY/fixture" && sleep 2',
      ],
      { stdio: "pipe", timeout: 30_000 },
    );
  }
  console.log(
    JSON.stringify({
      event: "image_manager.credentials_startup.passed",
      attempts: 5,
      sandbox: true,
      post: true,
    }),
  );
}
