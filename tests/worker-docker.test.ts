import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  dockerStopVerified,
  runDocker,
} from "../apps/renderer-worker/src/docker.js";
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture(body: string) {
  const root = await mkdtemp(join(tmpdir(), "worker-docker-cli-"));
  roots.push(root);
  const bin = join(root, "bin"),
    calls = join(root, "calls");
  await mkdir(bin);
  await writeFile(
    join(bin, "docker"),
    `#!${process.execPath}\nimport {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(calls)},JSON.stringify(process.argv.slice(2))+'\\n');${body}`,
    { mode: 0o755 },
  );
  await chmod(join(bin, "docker"), 0o755);
  vi.stubEnv("PATH", `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`);
  return { root, calls };
}
describe.skipIf(process.platform === "win32")(
  "bounded Docker daemon commands",
  () => {
    it("bounds a nonresponsive Docker CLI", async () => {
      await fixture("setInterval(()=>{},1000)");
      await expect(runDocker(["info"], 50)).rejects.toThrow("timed out");
    });
    it("bounds a flooding Docker response", async () => {
      await fixture("process.stdout.write('a'.repeat(2*1024*1024))");
      await expect(runDocker(["info"])).rejects.toThrow("exceeds limit");
    });
    it("verifies the exact name and rejects a still-present container", async () => {
      const f = await fixture(
        "if(process.argv[2]==='ps')console.log('abcdef123456');if(process.argv[2]==='inspect')console.log('running');",
      );
      const name = "latex-render-job_fixture-g1";
      await expect(dockerStopVerified(name)).rejects.toThrow(
        /could not be stopped: .*\(state=running\)/,
      );
      const calls = (await readFile(f.calls, "utf8"))
        .trim()
        .split("\n")
        .map((v) => JSON.parse(v) as string[]);
      expect(calls[2]).toEqual(["ps", "-aq", "--filter", `name=^${name}$`]);
      expect(calls[3]).toEqual(["rm", "--force", name]);
      expect(
        calls.every(
          (call) => call.includes(name) || call.includes(`name=^${name}$`),
        ),
      ).toBe(true);
    });
    it.each(["latex-render-job_fixture-g1", "abcdef123456"])(
      "confirms eventual auto-removal for exact identifier %s",
      async (identifier) => {
        const f = await fixture("process.exit(0)");
        // Install a deterministic daemon response sequence with a private counter.
        const counter = join(f.root, "counter");
        const executable = join(f.root, "bin/docker");
        await writeFile(
          executable,
          `#!${process.execPath}\nimport {appendFileSync,existsSync,readFileSync,writeFileSync}from'node:fs';const args=process.argv.slice(2);appendFileSync(${JSON.stringify(f.calls)},JSON.stringify(args)+'\\n');if(args[0]==='ps'){const path=${JSON.stringify(counter)},n=existsSync(path)?Number(readFileSync(path,'utf8')):0;writeFileSync(path,String(n+1));if(n<2)console.log('abcdef123456');}`,
          { mode: 0o755 },
        );
        await expect(dockerStopVerified(identifier)).resolves.toBeUndefined();
        const calls = (await readFile(f.calls, "utf8"))
          .trim()
          .split("\n")
          .map((v) => JSON.parse(v) as string[]);
        expect(calls.filter((call) => call[0] === "ps")).toHaveLength(3);
        expect(calls.filter((call) => call[0] === "rm")).toEqual([
          ["rm", "--force", identifier],
        ]);
        expect(
          calls
            .filter((call) => call[0] === "ps")
            .every((call) =>
              call.includes(
                identifier.startsWith("latex-render-")
                  ? `name=^${identifier}$`
                  : `id=${identifier}`,
              ),
            ),
        ).toBe(true);
      },
    );
    it("does not treat a failed daemon query as confirmed absence", async () => {
      await fixture(
        "if(process.argv[2]==='ps'){console.error('fixture unavailable');process.exit(1)}",
      );
      await expect(
        dockerStopVerified("latex-render-job_fixture-g1"),
      ).rejects.toThrow("fixture unavailable");
    });
    it("never sends an invalid container identifier to Docker", async () => {
      const f = await fixture("process.exit(0)");
      await expect(dockerStopVerified("--all")).rejects.toThrow("Invalid");
      await expect(readFile(f.calls)).rejects.toMatchObject({ code: "ENOENT" });
    });
  },
);
