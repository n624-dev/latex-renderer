import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

describe("consumer dependency restart boundaries (no systemd mutation)", () => {
  it.each([false, true])(
    "watchdog restores the complete consumer set and rejects a stopped gateway: %s",
    async (stuck) => {
      const source = await readFile(
          "deploy/scripts/watch-image-manager-operation.mjs",
          "utf8",
        ),
        list = /const rendererConsumers = (\[[\s\S]*?\]);/.exec(source)?.[1],
        body = /function restoreRendererConsumers\(units\) \{[\s\S]*?\n\}/.exec(
          source,
        )?.[0];
      if (!list || !body)
        throw new Error("Missing watchdog recovery implementation");
      const units = runInNewContext(list) as string[],
        calls: string[][] = [];
      expect(units).toContain("latex-renderer-admin-api.service");
      expect(units.at(-1)).toBe("latex-renderer-standalone-gateway.service");
      const execute = runInNewContext(`(${body})`, {
        systemctl: (args: string[]) => {
          calls.push(args);
          return {
            status:
              stuck &&
              args[0] === "is-active" &&
              args.at(-1) === "latex-renderer-standalone-gateway.service"
                ? 3
                : 0,
          };
        },
      }) as (units: string[]) => void;
      if (stuck) expect(() => execute(units)).toThrow("still inactive");
      else execute(units);
      expect(
        calls.filter((args) => args[0] === "start").map((args) => args[1]),
      ).toEqual(units);
      expect(
        calls
          .filter((args) => args[0] === "is-active")
          .map((args) => args.at(-1)),
      ).toEqual(units);
    },
  );
  it.each([true, false])(
    "restores the configured standalone gateway after Internal API: %s",
    async (enabled) => {
      const source = await readFile("deploy/scripts/image-manager.mjs", "utf8"),
        body =
          /async function restartRendererConsumers\(\) \{[\s\S]*?\n\}/.exec(
            source,
          )?.[0];
      if (!body) throw new Error("Missing consumer restart function");
      let gateway = enabled,
        internal = true;
      const calls: string[][] = [];
      const runCapture = (_command: string, args: string[]) => {
        calls.push([...args]);
        if (args[0] === "is-enabled" && !enabled)
          return Promise.reject(new Error("disabled"));
        if (
          args[0] === "try-restart" &&
          args.includes("latex-renderer-internal-api.service")
        ) {
          internal = true;
          gateway = false;
        }
        if (
          args[0] === "start" &&
          args.includes("latex-renderer-standalone-gateway.service")
        ) {
          expect(internal).toBe(true);
          gateway = true;
        }
        if (args[0] === "is-active" && !gateway)
          return Promise.reject(new Error("inactive"));
        return Promise.resolve("");
      };
      const execute = runInNewContext(`(${body})`, {
        runCapture,
      }) as () => Promise<void>;
      await execute();
      expect(gateway).toBe(enabled);
      expect(calls.some((args) => args[0] === "start")).toBe(enabled);
      if (enabled)
        expect(calls.at(-1)).toEqual([
          "is-active",
          "--quiet",
          "latex-renderer-standalone-gateway.service",
        ]);
    },
  );
  it.skipIf(process.platform === "win32").each(["standalone", "cloudflare"])(
    "deployment failure does not falsely certify stopped %s consumers",
    async (mode) => {
      const source = await readFile(
          "deploy/scripts/deploy-production-release.sh",
          "utf8",
        ),
        body = /^restore_services_after_failure\(\) \{[\s\S]*?^\}/m.exec(
          source,
        )?.[0];
      if (!body) throw new Error("Missing deployment restore function");
      const result = spawnSync(
        "/bin/sh",
        [
          "-c",
          `
      gateway=active; deployment_mode=${mode}; web_service=fixture-web
      systemctl() {
        case "$1" in
          restart) gateway=inactive ;;
          start) case " $* " in *" latex-renderer-standalone-gateway.service "*) gateway=active ;; esac ;;
          is-active) [ "$gateway" = active ] || return 1 ;;
        esac
      }
      ${body}
      restore_services_after_failure
      echo "gateway=$gateway"
    `,
        ],
        { encoding: "utf8", timeout: 2000 },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(
        `gateway=${mode === "standalone" ? "active" : "inactive"}`,
      );
      expect(result.stderr).toContain("Local services restored");
    },
  );
  it("gives existing-host recovery the same bounded drain budget as apply", async () => {
    const source = await readFile("deploy/scripts/server-setup.mjs", "utf8"),
      expression = /timeout:\s*([\s\S]*?),\s*maxBuffer:/.exec(source)?.[1];
    if (!expression) throw new Error("Missing prepared host timeout");
    for (const action of ["--recover", "--setup-apply"])
      expect(runInNewContext(expression, { action })).toBe(25 * 60_000);
    expect(runInNewContext(expression, { action: "--inspect" })).toBe(30_000);
  });
});
