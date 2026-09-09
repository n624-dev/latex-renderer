import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import {
  withoutUserEnvironmentDefaults,
  userEnvironmentKeys,
} from "../deploy/ci/host-user-environment.mjs";

it("removes only per-user assignments from disposable-host PAM defaults", () => {
  const retained =
    '# XDG_CONFIG_HOME=comment\nPATH="/usr/bin:/bin"\nLANG=C.UTF-8\nHTTPS_PROXY="https://proxy.invalid"\n';
  const input =
    retained +
    userEnvironmentKeys
      .map(
        (key, index) =>
          `${index % 2 ? " export " : ""}${key}="/home/runner/private"\n`,
      )
      .join("");
  expect(withoutUserEnvironmentDefaults(input)).toBe(retained);
  expect(withoutUserEnvironmentDefaults(retained)).toBe(retained);
  expect(withoutUserEnvironmentDefaults("XDG_CONFIG_HOME=/caller")).toBe("");
});

it("overrides caller and PAM paths after switching to the Docker worker", () => {
  const source = readFileSync(
    "deploy/scripts/configure-rootless-docker.sh",
    "utf8",
  );
  const definition = source.slice(
    source.indexOf("run_worker() {"),
    source.indexOf("loginctl enable-linger"),
  );
  const result = spawnSync(
    "sh",
    [
      "-eu",
      "-c",
      `
worker_user=latex-render-worker
worker_home=/var/lib/latex-render-worker
runtime_dir=/run/user/999
user_bus=unix:path=/run/user/999/bus
runuser() {
  test "$1" = -u && test "$2" = latex-render-worker && test "$3" = --
  shift 3
  # Model PAM reintroducing the runner's machine-wide variables.
  export XDG_CONFIG_HOME=/home/runner/.config XDG_RUNTIME_DIR=/run/user/1001
  "$@"
}
${definition}
run_worker "$1" -e 'console.log(JSON.stringify(Object.fromEntries(["HOME","XDG_CONFIG_HOME","XDG_DATA_HOME","XDG_CACHE_HOME","XDG_RUNTIME_DIR","DOCKER_CONFIG","DOCKER_HOST","DOCKER_CONTEXT","DBUS_SESSION_BUS_ADDRESS"].map(k=>[k,process.env[k]??null]))))'
`,
      "fixture",
      process.execPath,
    ],
    {
      env: {
        ...process.env,
        XDG_DATA_HOME: "/caller/data",
        XDG_CACHE_HOME: "/caller/cache",
        DOCKER_CONFIG: "/caller/docker",
        DOCKER_HOST: "tcp://caller:2375",
        DOCKER_CONTEXT: "caller",
      },
      encoding: "utf8",
    },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    HOME: "/var/lib/latex-render-worker",
    XDG_CONFIG_HOME: "/var/lib/latex-render-worker/.config",
    XDG_DATA_HOME: "/var/lib/latex-render-worker/.local/share",
    XDG_CACHE_HOME: "/var/lib/latex-render-worker/.cache",
    XDG_RUNTIME_DIR: "/run/user/999",
    DOCKER_CONFIG: "/var/lib/latex-render-worker/.docker",
    DOCKER_HOST: null,
    DOCKER_CONTEXT: null,
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/999/bus",
  });
});

it("uses the same rootless setup for new deployment and frozen-baseline provisioning", () => {
  const prepare = readFileSync("deploy/scripts/prepare-host.sh", "utf8");
  const provision = readFileSync("deploy/ci/provision-update-host.mjs", "utf8");
  expect(prepare).toContain(
    'sh "$source_root/deploy/scripts/configure-rootless-docker.sh"',
  );
  expect(provision).toContain(
    'resolve(source, "deploy/scripts/configure-rootless-docker.sh")',
  );
  expect(
    provision.indexOf("withoutUserEnvironmentDefaults(machineEnvironment)"),
  ).toBeGreaterThan(provision.indexOf('flag: "wx"'));
  expect(
    provision.indexOf("withoutUserEnvironmentDefaults(machineEnvironment)"),
  ).toBeLessThan(
    provision.indexOf('resolve(source, "deploy/scripts/install-host.sh")'),
  );
  expect(prepare).not.toContain("/etc/environment");
});
