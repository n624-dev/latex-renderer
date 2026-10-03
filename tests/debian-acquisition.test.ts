import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const source = readFileSync("renderer/install-debian-packages.sh", "utf8");
const timeoutCommand = ["gnutimeout", "timeout"].find((command) => {
  const version = spawnSync(command, ["--version"], { encoding: "utf8" });
  return version.status === 0 && version.stdout.includes("(GNU coreutils)");
});
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    // A regression in termination must not leave this fixture's TERM-ignoring
    // request alive. GNU timeout makes a private process group; its child
    // records that group ID before starting any fake APT command.
    const groupFile = join(root, "process-group");
    if (existsSync(groupFile)) {
      const group = Number(readFileSync(groupFile, "utf8").trim());
      if (!Number.isSafeInteger(group) || group <= 1 || group === process.pid)
        throw new Error("Invalid fixture process group");
      try {
        process.kill(-group, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
});
function fixture() {
  if (!timeoutCommand)
    throw new Error("GNU timeout or gnutimeout is required to match Debian");
  const root = mkdtempSync(join(tmpdir(), "debian-acquisition-"));
  roots.push(root);
  for (const dir of [
    "bin",
    "etc/apt/sources.list.d",
    "opt/renderer",
    "var/lib/apt/lists",
  ])
    mkdirSync(join(root, dir), { recursive: true });
  const trace = join(root, "trace");
  writeFileSync(trace, "");
  // Rewrite only filesystem destinations in this trusted script. Never execute
  // its real /etc, /opt, /var writes or the host's apt-get/dpkg-query.
  const body = source
    .replaceAll("/etc/apt", '"$TEST_ROOT/etc/apt"')
    .replaceAll("/opt/renderer", '"$TEST_ROOT/opt/renderer"')
    .replaceAll("/var/lib/apt/lists", '"$TEST_ROOT/var/lib/apt/lists"')
    .replace(
      "shift 3\n",
      'shift 3\nprintf "%s\\n" "$PPID" > "$TEST_ROOT/process-group"\n',
    );
  const script = join(root, "install.sh");
  writeFileSync(script, body);
  writeFileSync(
    join(root, "bin/timeout"),
    `#!/bin/sh\nexec ${timeoutCommand} "$@"\n`,
    { mode: 0o700 },
  );
  writeFileSync(
    join(root, "bin/apt-get"),
    `#!/bin/sh
count=0
[ ! -f "$TEST_ROOT/count" ] || read -r count < "$TEST_ROOT/count"
count=$((count + 1))
printf '%s\\n' "$count" > "$TEST_ROOT/count"
printf '%s\\n' "$*" >> "$TEST_TRACE"
sed -n '1p' "$TEST_ROOT/etc/apt/sources.list" >> "$TEST_TRACE"
[ "$count" != "\${TEST_FAIL:-}" ] || exit 42
if [ "$count" = "\${TEST_HANG:-}" ]; then
  if [ "\${TEST_IGNORE_TERM:-}" = true ]; then
    trap '' TERM
    while :; do sleep 1; done
  fi
  exec sleep 30
fi
`,
    { mode: 0o700 },
  );
  writeFileSync(
    join(root, "bin/dpkg-query"),
    `#!/bin/sh
printf 'dpkg-query\\n' >> "$TEST_TRACE"
[ "\${TEST_DPKG_FAIL:-}" != true ] || exit 42
printf 'z-package\\t2\\na-package\\t1\\n'
`,
    { mode: 0o700 },
  );
  const run = (
    env: Record<string, string> = {},
    snapshot = "20260812T235959Z",
  ) =>
    spawnSync("sh", [script, snapshot, "curl", "fontconfig"], {
      encoding: "utf8",
      timeout: 5_000,
      env: {
        ...process.env,
        PATH: `${root}/bin:${process.env.PATH}`,
        TEST_ROOT: root,
        TEST_TRACE: trace,
        DEBIAN_INSTALL_TIMEOUT_SECONDS: "1200",
        DEBIAN_ACQUIRE_TIMEOUT_SECONDS: "30",
        DEBIAN_ACQUIRE_RETRIES: "3",
        ...env,
      },
    });
  return { root, trace, script, body, run };
}

describe.skipIf(process.platform === "win32")(
  "bounded signed Debian acquisition",
  () => {
    it("bounds every request, uses strict updates and keeps the pinned bootstrap/HTTPS sequence", () => {
      const f = fixture(),
        result = f.run();
      expect(result.status, result.stderr).toBe(0);
      const trace = readFileSync(f.trace, "utf8");
      const commands = trace
        .split("\n")
        .filter((line) => line.startsWith("-o "));
      expect(commands).toHaveLength(4);
      for (const command of commands) {
        expect(command).toContain("Acquire::http::Timeout=30");
        expect(command).toContain("Acquire::https::Timeout=30");
        expect(command).toContain("Acquire::Retries=3");
        expect(command).toContain("Acquire::http::Pipeline-Depth=0");
        expect(command).toContain("Acquire::Languages=none");
      }
      expect(commands[0]).toContain("update --error-on=any");
      expect(commands[1]).toContain(
        "install -y --no-install-recommends ca-certificates",
      );
      expect(commands[2]).toContain("update --error-on=any");
      expect(commands[3]).toContain(
        "install -y --no-install-recommends curl fontconfig",
      );
      expect(trace.match(/http:\/\/snapshot\.debian\.org/g)).toHaveLength(2);
      expect(trace.match(/https:\/\/snapshot\.debian\.org/g)).toHaveLength(2);
      expect(trace).not.toContain("deb.debian.org");
      expect(
        readFileSync(join(f.root, "opt/renderer/debian-packages.txt"), "utf8"),
      ).toBe("a-package\t1\nz-package\t2\n");
      expect(
        existsSync(join(f.root, "opt/renderer/debian-packages.unsorted")),
      ).toBe(false);
      for (const phase of [
        "bootstrap-update",
        "bootstrap-ca",
        "https-update",
        "packages",
      ])
        expect(result.stdout).toMatch(
          new RegExp(`DEBIAN_APT_STAGE phase=${phase} seconds=\\d+ exit=0`),
        );
    });
    it.each([1, 2, 3, 4])(
      "never continues past failed APT call %s",
      (stage) => {
        const f = fixture(),
          result = f.run({ TEST_FAIL: String(stage) });
        expect(result.status, result.stderr).toBe(42);
        expect(readFileSync(join(f.root, "count"), "utf8").trim()).toBe(
          String(stage),
        );
        expect(result.stdout).toMatch(
          /DEBIAN_APT_STAGE phase=\S+ seconds=\d+ exit=42/,
        );
        expect(readFileSync(f.trace, "utf8")).not.toContain("dpkg-query");
      },
    );
    it("does not hide failed inventory collection behind a successful sort", () => {
      const f = fixture(),
        result = f.run({ TEST_DPKG_FAIL: "true" });
      expect(result.status).toBe(42);
      expect(existsSync(join(f.root, "opt/renderer/debian-packages.txt"))).toBe(
        false,
      );
    });
    it("enforces the whole-phase deadline with real GNU timeout, not just inactivity options", () => {
      const f = fixture(),
        result = f.run({ TEST_HANG: "1", DEBIAN_INSTALL_TIMEOUT_SECONDS: "1" });
      expect(
        result.error,
        result.stderr + readFileSync(f.trace, "utf8"),
      ).toBeUndefined();
      expect(result.status, result.stderr).toBe(124);
      expect(readFileSync(join(f.root, "count"), "utf8").trim()).toBe("1");
      expect(result.stdout).not.toContain("DEBIAN_INSTALL_PHASE=bootstrap-ca");
    });
    it("kills a request that ignores TERM after the grace period", () => {
      const f = fixture();
      // Keep this test small; production's force-kill grace remains 15 seconds.
      expect(source).toContain("--kill-after=15s");
      writeFileSync(
        f.script,
        f.body.replace("--kill-after=15s", "--kill-after=0.2s"),
      );
      const result = f.run({
        TEST_HANG: "1",
        TEST_IGNORE_TERM: "true",
        DEBIAN_INSTALL_TIMEOUT_SECONDS: "1",
      });
      expect(
        result.error,
        result.stderr + readFileSync(f.trace, "utf8"),
      ).toBeUndefined();
      expect(
        result.signal === "SIGKILL" || result.status === 137,
        result.stderr,
      ).toBe(true);
      expect(readFileSync(join(f.root, "count"), "utf8").trim()).toBe("1");
    });
    it.each([
      { DEBIAN_INSTALL_TIMEOUT_SECONDS: "0" },
      { DEBIAN_INSTALL_TIMEOUT_SECONDS: "3601" },
      { DEBIAN_ACQUIRE_TIMEOUT_SECONDS: "0" },
      { DEBIAN_ACQUIRE_TIMEOUT_SECONDS: "121" },
      { DEBIAN_ACQUIRE_RETRIES: "6" },
      { DEBIAN_ACQUIRE_RETRIES: "-1" },
      { DEBIAN_ACQUIRE_RETRIES: "1; echo unsafe" },
      { DEBIAN_INSTALL_TIMEOUT_SECONDS: "99999999999999999999999" },
    ])(
      "rejects malformed/out-of-range configuration %j before acquisition",
      (env) => {
        const f = fixture(),
          result = f.run(env);
        expect(result.status).toBe(64);
        expect(readFileSync(f.trace, "utf8")).toBe("");
      },
    );
    it("rejects snapshot path injection before writes or acquisition", () => {
      const f = fixture(),
        result = f.run({}, "../../outside");
      expect(result.status).toBe(64);
      expect(readFileSync(f.trace, "utf8")).toBe("");
    });
  },
);

it("both Dockerfiles use the same bounded helper without weakening archive/TLS verification", () => {
  for (const name of ["Dockerfile", "Dockerfile.base"]) {
    const dockerfile = readFileSync(`renderer/${name}`, "utf8");
    expect(dockerfile).toContain(
      "source=install-debian-packages.sh,target=/tmp/install-debian-packages.sh",
    );
    expect(dockerfile).toContain(
      'sh /tmp/install-debian-packages.sh "${DEBIAN_SNAPSHOT}"',
    );
    expect(dockerfile).toContain("ARG DEBIAN_INSTALL_TIMEOUT_SECONDS=1200");
    expect(dockerfile).toContain("ARG DEBIAN_ACQUIRE_TIMEOUT_SECONDS=30");
    expect(dockerfile).toContain("ARG DEBIAN_ACQUIRE_RETRIES=3");
    expect(dockerfile).not.toContain("apt-get");
  }
  for (const forbidden of [
    "trusted=yes",
    "--allow-unauthenticated",
    "Verify-Peer=false",
    "AllowInsecureRepositories",
    "Check-Date=false",
  ])
    expect(source).not.toContain(forbidden);
});
