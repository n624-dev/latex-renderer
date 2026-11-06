import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it.skipIf(process.platform === "win32")(
  "restores compact Gateway through activation before a later recovery acknowledgement",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "failure-recovery-"));
    try {
      const driver = await readFile(
        new URL(
          "../deploy/scripts/deploy-production-release.sh",
          import.meta.url,
        ),
        "utf8",
      );
      const start = driver.indexOf("restore_services_after_failure() {");
      const end = driver.indexOf("\ncleanup() {", start);
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      const fixture = join(root, "control.mjs");
      await writeFile(
        fixture,
        `
      import { readFileSync, writeFileSync, existsSync } from "node:fs";
      import { controlService, httpServiceStatus } from ${JSON.stringify(new URL("../deploy/scripts/http-services.mjs", import.meta.url).href)};
      const path = process.env.fixture_state;
      const state = existsSync(path) ? JSON.parse(readFileSync(path)) : {};
      const run = (action, ...args) => {
        const unit = args.at(-1);
        if (action === "show") return ["LoadState=loaded", "Result=success", "UnitFileState=enabled", "MainPID=0", "ActiveState=" + (state[unit] ? "active" : "inactive"), "SubState=" + (state[unit] ? (unit.endsWith(".socket") ? "listening" : "running") : "dead")].join("\\n");
        if (action === "start") {
          if (unit.endsWith(".socket") && state[unit.replace(/\\.socket$/, ".service")]) throw Error("Legacy process owns the port");
          state[unit] = true;
        } else if (action === "stop") state[unit] = false;
        return "";
      };
      const [kind, action, ...units] = process.argv.slice(2);
      for (const unit of units) {
        if (kind === "systemctl") run(action, unit);
        else if (action === "prepare") continue;
        else if (action === "ready") {
          if (!httpServiceStatus(unit, { run }).operational) throw Error("Not ready");
        } else controlService(action, unit, { run, enabled: true });
      }
      writeFileSync(path, JSON.stringify(state));
    `,
      );
      const env = {
        ...process.env,
        node_binary: process.execPath,
        fixture,
        fixture_state: join(root, "state.json"),
      };
      execFileSync(
        "bash",
        [
          "-eu",
          "-c",
          `
      systemctl() { "$node_binary" "$fixture" systemctl "$@"; }
      http_control() { "$node_binary" "$fixture" http "$@"; }
      restore_lan_services() { return 0; }
      deployment_mode=standalone
      web_service=latex-renderer-web.service
      ${driver.slice(start, end)}
      restore_services_after_failure
      [ "$recovery_failed" = false ]
      http_control start latex-renderer-standalone-gateway.service
    `,
        ],
        { env, stdio: "pipe", timeout: 20000 },
      );
      const state: Record<string, boolean> = JSON.parse(
        await readFile(env.fixture_state, "utf8"),
      ) as Record<string, boolean>;
      expect(state["latex-renderer-standalone-gateway.socket"]).toBe(true);
      expect(state["latex-renderer-standalone-gateway.service"]).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
