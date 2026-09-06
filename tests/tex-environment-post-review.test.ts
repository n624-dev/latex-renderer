import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adminScript } from "../apps/admin-web/src/assets/admin-script.js";

const read = (path: string): string => readFileSync(path, "utf8");

describe("post-review TeX environment regressions", () => {
  it("keeps reusable registry helpers defensive without exposing publish infrastructure", () => {
    const tagStatus = read("deploy/scripts/ghcr-tag-status.mjs");
    const retention = read("deploy/scripts/ghcr-retention.mjs");
    expect(tagStatus).toContain("process.env.GITHUB_TOKEN");
    expect(tagStatus).toContain("AbortSignal.timeout");
    expect(tagStatus).toContain("X-GitHub-Api-Version");
    expect(retention).toContain('"--prefer-index=false"');
    expect(retention).toContain("GHCR_PURGE_LEGACY_RUNTIMES");
    expect(retention).toContain("if (!purgeLegacyRuntimes) continue");
    expect(read(".github/workflows/renderer-image-daily.yml")).toContain(
      "inputs.purge_legacy_runtimes != true",
    );
    expect(read(".github/workflows/renderer-image-daily.yml")).toContain(
      '[[ "$REQUESTED_DATE" == latest ]]',
    );
    expect(retention).not.toContain("CLOUDFLARE");
  });

  it("uses a shared writable temp root and requires image restoration before renderer consumers", () => {
    const manager = read("deploy/systemd/latex-renderer-image-manager.service");
    const waitDocker = read("deploy/scripts/wait-rootless-docker.sh");
    const waitHttp = read("deploy/scripts/wait-image-manager-http.sh");
    const worker = read("deploy/systemd/latex-renderer-worker.service");
    const internal = read("deploy/systemd/latex-renderer-internal-api.service");
    const remote = read("deploy/systemd/latex-renderer-remote-mcp.service");
    expect(manager).toContain(
      "Environment=TMPDIR=/var/lib/latex-renderer/image-manager/tmp",
    );
    expect(manager).toContain(
      "ExecStartPre=/bin/sh deploy/scripts/wait-rootless-docker.sh",
    );
    expect(manager).toContain(
      "ExecStartPost=/bin/sh deploy/scripts/wait-image-manager-http.sh",
    );
    expect(manager).toContain("NoNewPrivileges=false");
    expect(manager).not.toContain("NoNewPrivileges=true");
    expect(manager).toContain("TimeoutStartSec=1h");
    expect(waitDocker).toContain("docker info >/dev/null 2>&1");
    expect(waitHttp).toContain('"$endpoint/v1/state"');
    expect(waitHttp).toContain("IMAGE_MANAGER_READY_ATTEMPTS");
    expect(waitHttp).toContain('[ "$status" = "401" ]');
    expect(waitHttp).not.toContain("Authorization: Bearer");
    expect(waitHttp).not.toContain("IMAGE_MANAGER_TOKEN_FILE");
    for (const unit of [worker, internal, remote]) {
      expect(unit).toContain("Requires=latex-renderer-image-manager.service");
      expect(unit).toContain(
        "After=network-online.target latex-renderer-image-manager.service",
      );
    }
  });

  it("journals image activation before renderer.env changes and recovers it after a manager restart", () => {
    const manager = read("deploy/scripts/image-manager.mjs");
    expect(manager).toContain(
      'activationJournalPath = join(stateRoot, "activation-journal.json")',
    );
    expect(manager).toContain(
      "const activationRecovery = await recoverPendingActivation()",
    );
    expect(manager).toContain("async function recoverPendingActivation()");
    expect(manager).toContain("async function activateAndPersistState");
    const journalWrite = manager.search(
      /await writeAtomic\(\s*activationJournalPath/,
    );
    const rendererWrite = manager.search(
      /await writeAtomic\(\s*rendererEnv,\s*newEnv/,
    );
    expect(journalWrite).toBeGreaterThanOrEqual(0);
    expect(rendererWrite).toBeGreaterThanOrEqual(0);
    expect(journalWrite).toBeLessThan(rendererWrite);
    expect(manager).toContain("journal.nextState");
    expect(manager).toContain("journal.previousState");
    expect(manager).toContain("Image activation was recovered and committed");
  });

  it("preserves existing legacy language choices only during an upgrade migration", () => {
    const prepare = read("deploy/scripts/prepare-host.sh");
    const manager = read("deploy/scripts/image-manager.mjs");
    expect(prepare).toContain("renderer_env_preexisting=false");
    expect(prepare).toContain("migrate-legacy-languages");
    expect(prepare).toContain('[ "$renderer_env_preexisting" = true ]');
    expect(manager).toContain("legacyMigrationMarker");
    expect(manager).toContain("legacyLanguageMigrationRequested");
    expect(manager).toContain("state.desired.languages = [...languages]");
    expect(manager).toContain("languages: []");
  });

  it("reconciles saved selectors through the same manager path during deployment", () => {
    const manager = read("deploy/scripts/image-manager.mjs");
    const deploy = read("deploy/scripts/deploy-production-release.sh");
    expect(manager).toContain("async function reconcileDesired(op)");
    expect(manager).toContain('selector.mode === "latest"');
    expect(manager).toContain('rebuildIfMissing: selector.mode === "date"');
    expect(manager).toContain('url.pathname === "/v1/reconcile"');
    expect(deploy).toContain("reconcile-managed-runtime.mjs");
  });

  it("quiesces image mutations before production deploy changes the release or state", () => {
    const deploy = read("deploy/scripts/deploy-production-release.sh");
    const quiesce = read("deploy/scripts/quiesce-image-manager.sh");
    expect(deploy).toContain(
      'sh "$source_root/deploy/scripts/quiesce-image-manager.sh"',
    );
    expect(deploy.indexOf("quiesce-image-manager.sh")).toBeLessThan(
      deploy.indexOf("prepare-host.sh"),
    );
    expect(quiesce).toContain(
      'systemctl stop "$refresh_timer" "$watchdog_timer"',
    );
    expect(quiesce).toContain('systemctl stop "$admin_unit"');
    expect(quiesce).toContain("POST /v1/quiesce");
    expect(quiesce).toContain(".activeOperationId == null");
    expect(quiesce).toContain('systemctl stop "$manager_unit"');
  });

  it("pins the Debian substrate, bounds external TeX requests, and refuses an unprepared annual rollover", () => {
    for (const path of ["renderer/Dockerfile.base", "renderer/Dockerfile"]) {
      const dockerfile = read(path);
      expect(dockerfile).toContain("ARG DEBIAN_SNAPSHOT=20260812T235959Z");
      expect(dockerfile).toContain(
        "http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}/",
      );
      expect(dockerfile).toContain(
        "sed -i 's|http://snapshot.debian.org/|https://snapshot.debian.org/|g'",
      );
      expect(dockerfile).toContain("--connect-timeout 15");
      expect(dockerfile).toContain("--max-time 600");
    }
    const resolver = read("deploy/scripts/resolve-texlive-snapshot.sh");
    const profile = read("deploy/scripts/generate-texlive-profile.sh");
    expect(resolver).toContain("TEXLIVE_CURL_CONNECT_TIMEOUT_SECONDS");
    expect(resolver).toContain('--max-time "$curl_max_time"');
    expect(resolver).toContain("supported_year=2026");
    expect(resolver).toContain("annual TeX Live migration");
    expect(profile).toContain("TEXLIVE_PROFILE_CURL_MAX_TIME_SECONDS");
    expect(profile).toContain('--connect-timeout "$curl_connect_timeout"');
  });

  it("keeps registry and language-catalog outage behavior common without hiding manager failures", () => {
    const manager = read("deploy/scripts/image-manager.mjs");
    const routes = read("apps/admin-api/src/routes/tex-environment.ts");
    const cli = read("apps/admin-cli/src/index.ts");
    expect(manager).toContain('await runCapture("curl", [');
    expect(manager).toMatch(/"--connect-timeout",\s*"10",\s*"--max-time"/);
    expect(manager).toContain('magic.toString("hex") !== "fd377a585a00"');
    expect(routes).toContain("registryUnavailable: true");
    expect(routes).toContain('error.code === "IMAGE_MANAGER_UNAVAILABLE"');
    expect(routes).toContain("error.status < 500");
    expect(routes).toContain("catalogUnavailable = true");
    expect(adminScript).toContain("images.registryUnavailable");
    expect(adminScript).toContain("languages.catalogUnavailable?' disabled':'");
    expect(adminScript).toContain("if(languages.catalogUnavailable)return");
    expect(cli).toContain("TEX_LANGUAGE_CATALOG_UNAVAILABLE");
  });

  it("re-applies desired language drift in every latest-refresh path", () => {
    const client = read("apps/admin-api/src/services/image-manager.ts");
    const runner = read("deploy/scripts/run-image-refresh.mjs");
    const manager = read("deploy/scripts/image-manager.mjs");
    for (const source of [client, runner]) {
      expect(source).toContain("runtimeDrift");
      expect(source).toContain("desiredLanguages");
      expect(source).toContain("currentLanguages");
      expect(source).toContain('selector: { mode: "latest", value: null }');
      expect(source).toContain("rebuildIfMissing: false");
    }
    expect(manager).toContain("const runtimeDrift =");
    expect(manager).toContain(
      "sameLanguages(state.desired.languages, state.current?.languages)",
    );
    expect(manager).toContain(
      "Already using the latest validated base with the desired language set",
    );
  });

  it("enforces country and operation exclusion inside the privileged helper", () => {
    const manager = read("deploy/scripts/image-manager.mjs");
    expect(manager).toContain("let mutationGate = Promise.resolve()");
    expect(manager).toContain("async function serializeMutation");
    expect(manager).toContain("async function setCountryOverride");
    expect(manager).toContain(
      "Country override cannot change while an image operation is running",
    );
    expect(manager).toContain("async function quiesceManager");
    expect(manager).toContain(
      "Cannot quiesce while an image operation is running",
    );
    expect(manager).toContain('url.pathname === "/v1/quiesce"');
  });

  it("does not reread an unbounded operation log and prunes old builder cache", () => {
    const manager = read("deploy/scripts/image-manager.mjs");
    expect(manager).toContain("async function readLogTail");
    expect(manager).toContain("const length = Math.min(info.size, maxBytes)");
    expect(manager).toContain("Math.max(0, info.size - length)");
    expect(manager).toMatch(
      /"builder",\s*"prune",\s*"--force",\s*"--filter",\s*"until=168h"/,
    );
  });

  it("does not convert successful runtime activation into a false failed operation on bookkeeping errors", () => {
    const manager = read("deploy/scripts/image-manager.mjs");
    expect(manager).toContain("async function finishOperationSucceeded");
    expect(manager).toContain("completion metadata could not be saved");
    expect(manager).toContain("housekeeping state could not be saved");
    expect(manager).not.toContain(
      '.then(async () => {\n      op.status = "succeeded"',
    );
  });

  it("lets active jobs drain and periodically recovers leases missed at worker startup", () => {
    const worker = read("apps/renderer-worker/src/index.ts");
    const periodicRecovery = read(
      "apps/renderer-worker/src/periodic-recovery.ts",
    );
    const unit = read("deploy/systemd/latex-renderer-worker.service");
    expect(unit).toContain("TimeoutStopSec=15min");
    expect(worker).toContain("await recoverExpiredLeases()");
    expect(periodicRecovery).toContain("nextRecoveryAt");
    expect(periodicRecovery).toContain(
      "await recoverStaleLeases(database, config)",
    );
    expect(periodicRecovery).toContain("renderer_worker.lease_recovery_failed");
  });

  it("keeps automatic refresh alive long enough to observe the four-hour watchdog recovery", () => {
    const runner = read("deploy/scripts/run-image-refresh.mjs");
    const refresh = read("deploy/systemd/latex-renderer-image-refresh.service");
    const watchdog = read(
      "deploy/systemd/latex-renderer-image-operation-watchdog.service",
    );
    expect(watchdog).toContain("IMAGE_OPERATION_MAX_AGE_MS=14400000");
    expect(refresh).toContain("IMAGE_REFRESH_MAX_WAIT_MS=16200000");
    expect(refresh).toContain("TimeoutStartSec=4h40min");
    expect(runner).toContain("image_refresh.reconnecting");
    expect(runner).toContain("requestFailures");
  });

  it("bounds stale image operations with a systemd watchdog and restores consumers", () => {
    const watchdog = read("deploy/scripts/watch-image-manager-operation.mjs");
    const service = read(
      "deploy/systemd/latex-renderer-image-operation-watchdog.service",
    );
    const timer = read(
      "deploy/systemd/latex-renderer-image-operation-watchdog.timer",
    );
    const deploy = read("deploy/scripts/deploy-production-release.sh");
    expect(watchdog).toContain("IMAGE_OPERATION_MAX_AGE_MS");
    expect(watchdog).toContain(
      '"restart", "latex-renderer-image-manager.service"',
    );
    expect(watchdog).toContain("activeOperationId");
    expect(watchdog).toContain("waitForManagerState");
    expect(watchdog).toContain("previouslyActiveConsumers");
    expect(service).toContain("IMAGE_OPERATION_MAX_AGE_MS=14400000");
    expect(service).toContain("Wants=latex-renderer-image-manager.service");
    expect(timer).toContain("OnUnitActiveSec=5min");
    expect(deploy).toContain("latex-renderer-image-operation-watchdog.timer");
  });

  it("records TeX mutations in the existing admin audit log", () => {
    const routes = read("apps/admin-api/src/routes/tex-environment.ts");
    expect(routes).toContain("tex_environment.apply_requested");
    expect(routes).toContain("tex_environment.country_updated");
    expect(routes).toContain("tex_environment.${action}_requested");
    expect(routes).toContain("deps.database.audit");
  });

  it("keeps changed Node and shell entrypoints syntactically valid", () => {
    for (const path of [
      "deploy/scripts/image-manager.mjs",
      "deploy/scripts/run-image-refresh.mjs",
      "deploy/scripts/watch-image-manager-operation.mjs",
      "deploy/scripts/reconcile-managed-runtime.mjs",
    ]) {
      const syntax = spawnSync(process.execPath, ["--check", path], {
        encoding: "utf8",
      });
      expect(syntax.status, `${path}: ${syntax.stderr}`).toBe(0);
    }
    if (process.platform !== "win32") {
      for (const path of [
        "deploy/scripts/quiesce-image-manager.sh",
        "deploy/scripts/prepare-host.sh",
        "deploy/scripts/resolve-texlive-snapshot.sh",
        "deploy/scripts/wait-rootless-docker.sh",
        "deploy/scripts/wait-image-manager-http.sh",
      ]) {
        const syntax = spawnSync("sh", ["-n", path], { encoding: "utf8" });
        expect(syntax.status, `${path}: ${syntax.stderr}`).toBe(0);
      }
    }
  });
});
