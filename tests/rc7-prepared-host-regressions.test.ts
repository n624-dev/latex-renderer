import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
describe("prepared-host deployment wiring regressions", () => {
  it.each([
    [false, false, "latex-renderer-admin-web.service"],
    [true, false, "latex-renderer-web.service"],
    [false, true, "latex-renderer-web.service"],
    [true, true, "latex-renderer-web.service"],
  ])(
    "selects the installed Web service (enabled=%s, active=%s)",
    (enabled, active, expected) => {
      const source = read("deploy/scripts/deploy-production-release.sh");
      const selection = source.slice(
        source.indexOf("web_service="),
        source.indexOf('cd "$source_root"'),
      );
      const result = spawnSync(
        "sh",
        [
          "-c",
          `systemctl() {
      case "$1" in is-enabled) return ${enabled ? 0 : 1} ;; is-active) return ${active ? 0 : 1} ;; *) return 99 ;; esac
    }
    ${selection}
    printf '%s' "$web_service"`,
        ],
        { encoding: "utf8", timeout: 5000 },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe(expected);
      expect(source.match(/"\$web_service"/g)).toHaveLength(3);
    },
  );
  it("rejects missing prerequisites and wrong build ownership before tooling creation or service mutation", () => {
    const source = read("deploy/scripts/deploy-production-release.sh");
    const before = (first: string, second: string) => {
      expect(source.indexOf(first)).toBeGreaterThanOrEqual(0);
      expect(source.indexOf(first)).toBeLessThan(source.indexOf(second));
    };
    before("command -v unzip", "web_service=");
    before("sync_uid=$(id", 'runuser -u "$sync_user" -- mkdir');
    before(
      'corepack prepare "$sync_package_manager"',
      "deployment_checkpoint quiesce-and-prepare-host",
    );
    expect(source).toContain('COREPACK_HOME="$sync_corepack_home"');
    expect(source).not.toContain('sync_pnpm_bin="$sync_home/');
    expect(read("deploy/scripts/install-host.sh")).toContain(
      "libarchive-tools unzip",
    );
    expect(read("deploy/scripts/server-setup-prepare.mjs")).toContain(
      '"/usr/bin/unzip"',
    );
  });
  it("clears inherited setgid bits in both OS preparation paths", () => {
    for (const path of [
      "deploy/scripts/install-host.sh",
      "deploy/scripts/prepare-host.sh",
    ])
      expect(read(path)).toContain(
        "chmod 00750 /var/lib/latex-renderer/backups /var/lib/latex-renderer/audit",
      );
  });
  it("restores a boot lock before any journal recovery and installs the GC entry", () => {
    const boot = read("deploy/scripts/server-setup-recovery.mjs");
    expect(boot.indexOf("await prepareServerSetupMutationLock()")).toBeLessThan(
      boot.indexOf("const journal ="),
    );
    const prepare = read("deploy/scripts/server-setup-prepare.mjs");
    const pending = prepare.slice(
      prepare.indexOf("if (pending)"),
      prepare.indexOf('await absent("/etc'),
    );
    expect(pending).toContain("await prepareRuntimeMutationLock(gid)");
    expect(prepare).toContain(
      'path: "/usr/local/libexec/latex-renderer-update-recovery.mjs"',
    );
    expect(prepare).toContain(
      "${release}/deploy/scripts/update-recovery-entry.mjs",
    );
  });
  it("prepares committed SQLite permissions before consumers, and waits for health before socket inspection", () => {
    const source = read("deploy/scripts/server-setup-initial-host.mjs");
    const validation = source.slice(
      source.indexOf("async validatePublished"),
      source.indexOf("async health(files)"),
    );
    expect(
      validation.indexOf("await prepareApplicationDatabase("),
    ).toBeLessThan(validation.indexOf("configure-renderer-storage-acl.sh"));
    expect(validation).not.toContain("createOnly: true");
    const health = source.slice(source.indexOf("async health(files)"));
    expect(health.indexOf("await checkAuthenticationHealth")).toBeLessThan(
      health.indexOf("assertServerSetupSockets("),
    );
    expect(health.indexOf("await checkIngressHttpsHealth")).toBeLessThan(
      health.indexOf("assertServerSetupSockets("),
    );
  });
  it("keeps ingress non-root, bind-only and sandboxed, with matching runtime ownership", () => {
    const unit = read("deploy/systemd/latex-renderer-ingress.service");
    expect(unit).toMatch(/^User=latex-renderer$/m);
    expect(unit).toMatch(/^CapabilityBoundingSet=CAP_NET_BIND_SERVICE$/m);
    expect(unit).toMatch(/^AmbientCapabilities=CAP_NET_BIND_SERVICE$/m);
    expect(unit).toContain("NoNewPrivileges=true");
    expect(unit).toContain("RestrictSUIDSGID=true");
    expect(unit).not.toMatch(/CAP_SETUID|CAP_SETGID|CAP_DAC_OVERRIDE/);
    const initial = read("deploy/scripts/server-setup-initial-host.mjs");
    expect(initial).toContain('"/run/latex-renderer-ingress",');
    expect(initial).toMatch(/0o750,\s+rendererUid/);
    expect(initial).not.toContain("user latex-renderer;\\n");
    const recovery = read(
      "deploy/systemd/latex-renderer-authentication-recovery.service",
    );
    expect(recovery).toMatch(/^ReadWritePaths=.* \/var\/lib\/latex-renderer$/m);
    expect(recovery).toContain("ProtectSystem=strict");
  });
});
