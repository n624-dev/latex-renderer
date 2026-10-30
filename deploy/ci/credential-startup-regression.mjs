import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readFile, mkdir, readdir } from "node:fs/promises";
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
  // Test the installed unit with its real credentials and pre/post commands.
  // A transient imitation has different command/property expansion semantics.
  const service = "latex-renderer-image-manager.service";
  const show = () =>
    Object.fromEntries(
      execFileSync(
        "/usr/bin/systemctl",
        [
          "show",
          service,
          "--property=Type,ProtectSystem,RestrictSUIDSGID,ExecStartPost,ActiveState,SubState,NRestarts,InvocationID",
        ],
        { encoding: "utf8", timeout: 10_000 },
      )
        .trim()
        .split("\n")
        .map((line) => {
          const equal = line.indexOf("=");
          return [line.slice(0, equal), line.slice(equal + 1)];
        }),
    );
  const before = show();
  assert.equal(before.Type, "exec");
  // systemctl show prints this structured D-Bus property as [unprintable]
  // on systemd 255. Read the typed property instead of its human rendering.
  const credentials = JSON.parse(
    execFileSync(
      "/usr/bin/busctl",
      [
        "--json=short",
        "get-property",
        "org.freedesktop.systemd1",
        "/org/freedesktop/systemd1/unit/latex_2drenderer_2dimage_2dmanager_2eservice",
        "org.freedesktop.systemd1.Service",
        "LoadCredential",
      ],
      { encoding: "utf8", timeout: 10_000 },
    ),
  );
  assert.equal(credentials.type, "a(ss)");
  assert.deepEqual(credentials.data, [
    ["image-manager-token", "/etc/latex-renderer/secrets/image-manager-token"],
  ]);
  assert.equal(before.ProtectSystem, "strict");
  assert.equal(before.RestrictSUIDSGID, "yes");
  assert.match(before.ExecStartPost, /wait-image-manager-http\.sh/);
  const invocations = new Set([before.InvocationID]);
  for (let attempt = 0; attempt < 5; attempt++) {
    execFileSync("/usr/bin/systemctl", ["restart", service], {
      stdio: "pipe",
      timeout: 120_000,
    });
    execFileSync(
      "/bin/sh",
      [join(candidate, "deploy/scripts/wait-image-manager-http.sh")],
      { stdio: "pipe", timeout: 90_000 },
    );
    const current = show();
    assert.equal(current.ActiveState, "active");
    assert.equal(current.SubState, "running");
    assert.equal(current.NRestarts, "0", "An automatic retry masked a startup failure");
    assert.match(current.InvocationID, /^[a-f0-9]{32}$/);
    assert(!invocations.has(current.InvocationID), "A fresh process must start");
    invocations.add(current.InvocationID);
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
