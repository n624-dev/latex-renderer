import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runServerSetupChild } from "../deploy/scripts/server-setup-child.mjs";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    // Emergency fixture cleanup only: prove a still-running process has this
    // unique fixture in its argv before signalling its private process group.
    for (const name of ["leader", "descendant"]) {
      const pid = Number(
        await readFile(join(root, name), "utf8").catch(() => ""),
      );
      if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid)
        continue;
      const argv = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(
        () => "",
      );
      if (!argv.includes(root)) continue;
      const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "");
      const group = Number(
        stat.slice(stat.lastIndexOf(") ") + 2).split(" ")[2],
      );
      if (!Number.isSafeInteger(group) || group <= 1 || group === process.pid)
        throw new Error("Unsafe fixture group");
      try {
        process.kill(-group, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    await rm(root, { recursive: true });
  }
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "server-setup-child-"));
  roots.push(root);
  return root;
}
const request = (
  script: string,
  input = "",
  options: {
    timeoutMs?: number;
    maxOutputBytes?: number;
    killGraceMs?: number;
  } = {},
) =>
  runServerSetupChild(process.execPath, ["-e", script], input, {
    timeoutMs: 2000,
    killGraceMs: 100,
    ...options,
  });
async function assertNotRunning(pid: number) {
  const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "");
  // A zombie awaiting init reaping or transient dead task cannot execute.
  if (stat)
    expect(["Z", "X"]).toContain(
      stat.slice(stat.lastIndexOf(") ") + 2).split(" ")[0],
    );
}

describe.skipIf(process.platform !== "linux")(
  "bounded prepared setup children",
  () => {
    it("pipes credentials, bounds stdout and does not forward loader/TLS/token environment", async () => {
      vi.stubEnv("PRIVATE_API_TOKEN", "fixture-ambient-secret");
      vi.stubEnv("NODE_OPTIONS", "--require /missing-fixture-loader");
      vi.stubEnv("NODE_TLS_REJECT_UNAUTHORIZED", "0");
      const secret = "fixture-pipe-secret";
      const output = await request(
        `let input=''; process.stdin.on('data', c=>input+=c);
       process.stdin.on('end',()=>process.stdout.write(JSON.stringify({
         input, argv:process.argv, env:process.env
       })));`,
        secret,
        { maxOutputBytes: 1024 },
      );
      const result = JSON.parse(output) as {
        input: string;
        argv: string[];
        env: Record<string, string>;
      };
      expect(result.input).toBe(secret);
      expect(result.argv).not.toContain(secret);
      expect(result.env).toEqual({
        PATH: "/usr/local/bin:/usr/bin:/bin",
        LANG: "C.UTF-8",
      });
    });

    it("discards owner stdout instead of accumulating arbitrary output", async () => {
      expect(
        await request("process.stdout.write('x'.repeat(1024*1024));"),
      ).toBe("");
    });

    it("accepts exactly the byte cap and counts UTF-8 bytes, not characters", async () => {
      expect(
        await request("process.stdout.write('x'.repeat(1024));", "", {
          maxOutputBytes: 1024,
        }),
      ).toHaveLength(1024);
      await expect(
        request("process.stdout.write('あ'.repeat(342));", "", {
          maxOutputBytes: 1024,
        }),
      ).rejects.toThrow("output limit");
    });

    it("does not accept a zero exit after excessive output", async () => {
      await expect(
        request(
          "process.on('SIGTERM',()=>process.exit(0)); process.stdout.write('x'.repeat(1025)); setInterval(()=>{},1000);",
          "",
          { maxOutputBytes: 1024 },
        ),
      ).rejects.toThrow("output limit");
    });

    it("does not accept a zero exit after the deadline", async () => {
      await expect(
        request(
          "process.on('SIGTERM',()=>process.exit(0)); setInterval(()=>{},1000);",
        ),
      ).rejects.toThrow("timed out");
    });

    it("kills a TERM-ignoring child before returning and rejects without leaking stdin", async () => {
      const root = await fixture();
      const script = `require('node:fs').writeFileSync(${JSON.stringify(join(root, "leader"))},String(process.pid));
      process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);`;
      const started = Date.now();
      await expect(
        request(script, "fixture-secret-not-in-errors"),
      ).rejects.toThrow("timed out");
      expect(Date.now() - started).toBeLessThan(6000);
      await assertNotRunning(
        Number(await readFile(join(root, "leader"), "utf8")),
      );
    });

    it("kills an ignoring descendant even when the wrapper exits zero on TERM", async () => {
      const root = await fixture();
      const descendant = `require('node:fs').writeFileSync(${JSON.stringify(join(root, "descendant"))},String(process.pid));
      process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);`;
      const wrapper = `require('node:fs').writeFileSync(${JSON.stringify(join(root, "leader"))},String(process.pid));
      require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});
      process.on('SIGTERM',()=>process.exit(0)); setInterval(()=>{},1000);`;
      await expect(request(wrapper)).rejects.toThrow("timed out");
      await assertNotRunning(
        Number(await readFile(join(root, "leader"), "utf8")),
      );
      await assertNotRunning(
        Number(await readFile(join(root, "descendant"), "utf8")),
      );
    });

    it("keeps the deadline while descendant-held stdout delays close after wrapper exit", async () => {
      const root = await fixture();
      const descendant = `require('node:fs').writeFileSync(${JSON.stringify(join(root, "descendant"))},String(process.pid));
      process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);`;
      const wrapper = `require('node:fs').writeFileSync(${JSON.stringify(join(root, "leader"))},String(process.pid));
      require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore',1,2]}).unref();`;
      await expect(
        request(wrapper, "", { maxOutputBytes: 1024 }),
      ).rejects.toThrow("timed out");
      await assertNotRunning(
        Number(await readFile(join(root, "descendant"), "utf8")),
      );
    });

    it("stops a remaining descendant on wrapper failure, not only timeout", async () => {
      const root = await fixture();
      const descendant = `require('node:fs').writeFileSync(${JSON.stringify(join(root, "descendant"))},String(process.pid));
      process.on('SIGTERM',()=>{}); process.stdout.write('ready'); setInterval(()=>{},1000);`;
      const wrapper = `require('node:fs').writeFileSync(${JSON.stringify(join(root, "leader"))},String(process.pid));
      const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore','pipe','ignore']});
      c.stdout.once('data',()=>process.exit(7));`;
      await expect(request(wrapper)).rejects.toThrow(
        "Prepared setup child failed",
      );
      await assertNotRunning(
        Number(await readFile(join(root, "descendant"), "utf8")),
      );
    });

    it("reports spawn/exit failures without child errors or private input", async () => {
      await expect(
        runServerSetupChild("/missing/fixture-command", [], "private-input", {
          timeoutMs: 1000,
        }),
      ).rejects.toThrow("Prepared setup child failed");
      await expect(
        request(
          "process.stderr.write('private-child-error');process.exit(7);",
          "private-input",
        ),
      ).rejects.toThrow(/^Prepared setup child failed$/);
    });

    it("rejects invalid bounds and oversized requests before spawning", async () => {
      for (const options of [
        { timeoutMs: 0 },
        { timeoutMs: 60_001 },
        { timeoutMs: NaN },
        { maxOutputBytes: -1 },
        { maxOutputBytes: 1025 },
        { killGraceMs: 0 },
        { killGraceMs: 2001 },
      ])
        await expect(request("process.exit(0)", "", options)).rejects.toThrow(
          "Invalid prepared",
        );
      await expect(
        request("process.exit(0)", "あ".repeat(11_000)),
      ).rejects.toThrow("Invalid prepared");
    });

    it.skipIf(!existsSync("/usr/bin/age-keygen"))(
      "derives the real age recipient through the bounded anonymous pipe",
      async () => {
        const identity = execFileSync("/usr/bin/age-keygen", [], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        const expected = execFileSync("/usr/bin/age-keygen", ["-y"], {
          input: identity,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "ignore"],
        });
        expect(
          await runServerSetupChild("/usr/bin/age-keygen", ["-y"], identity, {
            timeoutMs: 5000,
            maxOutputBytes: 1024,
          }),
        ).toBe(expected);
      },
    );
  },
);
