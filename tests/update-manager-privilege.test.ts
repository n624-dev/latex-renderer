import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("application updater privilege boundary", () => {
  it("keeps the controller non-root and limits its privileged IPC to one helper", () => {
    const manager = read("deploy/scripts/update-manager.mjs");
    const unit = read("deploy/systemd/latex-renderer-update-manager.service");
    expect(manager).toContain("Update Manager controller must not run as root");
    expect(manager).toContain(
      'const privilegedHelper = "/usr/local/libexec/latex-renderer-update-helper"',
    );
    expect(manager).toMatch(/spawn\(\s*"\/usr\/bin\/sudo"/);
    expect(manager).not.toContain('spawn("systemctl"');
    expect(manager).not.toContain('spawn("systemd-run"');
    expect(unit).toContain("User=latex-renderer-update");
    expect(unit).toContain("Group=latex-renderer");
    expect(unit).toContain("ProtectHome=true");
    expect(unit).toContain("ProtectSystem=strict");
    expect(unit).toContain(
      "GH_CONFIG_DIR=/var/lib/latex-renderer/update-manager/gh-config",
    );
    expect(unit).toContain("GH_PROMPT_DISABLED=1");
    expect(unit).toContain("PrivateDevices=true");
    expect(unit).toContain(
      "ReadWritePaths=/var/lib/latex-renderer/update-manager /run/latex-renderer",
    );
    expect(unit).not.toContain("ReadWritePaths=/opt/latex-renderer");
    expect(unit).not.toContain("ReadWritePaths=/etc/systemd/system");
    expect(unit).not.toContain("ReadWritePaths=/etc/apparmor.d");
  });

  it("validates helper verbs and derives all filesystem paths from fixed roots", () => {
    const helper = read("deploy/scripts/update-manager-helper.mjs");
    const launcher = read("deploy/scripts/update-manager-helper-launcher.sh");
    const sudoers = read("deploy/sudoers.d/latex-renderer-update");
    expect(helper).toContain("if (process.getuid?.() !== 0)");
    expect(helper).toContain('const repository = "n624-dev/latex-renderer"');
    expect(helper).toContain(
      'const stateRoot = "/var/lib/latex-renderer/update-manager"',
    );
    expect(helper).toContain(
      'const privilegedStagingRoot = "/opt/latex-renderer/update-staging"',
    );
    expect(helper).toContain(
      'const releaseRoot = "/opt/latex-renderer/releases"',
    );
    expect(helper).toContain("function directChild(root, name)");
    expect(helper).toContain('case "apply":');
    expect(helper).toContain('case "rollback":');
    expect(helper).toContain('case "bootstrap":');
    expect(helper).toContain('case "schedule-manager-restart":');
    expect(helper).toContain("Update helper verb is not allowed");
    expect(helper).toContain("Update staging identifier is invalid");
    expect(helper).toContain(
      "Staged release bundle digest does not match GitHub",
    );
    expect(helper).toContain(
      "Root-owned release bundle digest does not match GitHub",
    );
    expect(helper).toContain("GH_CONFIG_DIR");
    expect(helper).toContain('GH_PROMPT_DISABLED: "1"');
    expect(helper).toContain(
      'const githubCliCandidates = ["/usr/local/bin/gh", "/usr/bin/gh"]',
    );
    expect(helper).toContain("info.uid !== 0");
    expect(helper).toContain("(info.mode & 0o022) !== 0");
    expect(helper).toContain('compareVersions(version, "2.98.0") < 0');
    expect(helper).toContain('["attestation", "verify", "--help"]');
    expect(helper).toContain('"--source-ref"');
    expect(helper).toContain("`refs/tags/${release.tag}`");
    expect(helper).not.toContain("request.command");
    expect(helper).not.toContain("request.path");
    expect(helper).not.toContain("request.url");
    expect(launcher).toContain("does not accept command-line arguments");
    expect(launcher).toContain(
      "/opt/latex-renderer/current/deploy/scripts/update-manager-helper.mjs",
    );
    expect(launcher).toContain("/usr/bin/systemd-run --pipe --wait --collect");
    expect(launcher).toContain(
      "/usr/bin/flock --nonblock --exclusive /opt/latex-renderer/update-staging/update-helper.lock",
    );
    expect(sudoers).toContain(
      "latex-renderer-update ALL=(root) NOPASSWD: NOSETENV: /usr/local/libexec/latex-renderer-update-helper",
    );
  });

  it("preserves the root release tree and only overlays declared build outputs", () => {
    const helper = read("deploy/scripts/update-manager-helper.mjs");
    const assembly = read("deploy/scripts/release-assembly.mjs");
    expect(helper).toContain("assembleBuildArtifacts");
    expect(helper).toContain("verifiedSource: prepared.source");
    expect(helper).toContain("buildSource,");
    expect(helper).toContain(
      'await runLogged("chown", ["-R", "root:root", assembly])',
    );
    expect(assembly).toContain("--include=/apps/*/dist/***");
    expect(assembly).toContain("--include=/packages/*/dist/***");
    expect(assembly).toContain("Build output symlink escapes the release");
    expect(assembly).toContain(
      "Build output contains a special filesystem entry",
    );
    expect(helper).toContain('["-R", "u=rwX,g=rX,o=", assembly]');
    expect(helper).toContain("Rollback release tree is not sealed");
  });
});
