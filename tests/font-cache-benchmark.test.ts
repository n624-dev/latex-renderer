import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
describe.skipIf(process.platform === "win32")(
  "font cache comparison boundaries",
  () => {
    function fixture(extra: Record<string, string> = {}) {
      const root = mkdtempSync(join(tmpdir(), "font-cache-benchmark-"));
      roots.push(root);
      mkdirSync(join(root, "bin"));
      mkdirSync(join(root, "tmp"));
      writeFileSync(
        join(root, "bin/docker"),
        `#!${process.execPath}
const fs=require('node:fs'),p=require('node:path'),a=process.argv.slice(2),r=process.env.TEST_ROOT;
fs.appendFileSync(p.join(r,'trace'),JSON.stringify(a)+'\\n');
if(a[0]==='build')fs.writeFileSync(a[a.indexOf('--iidfile')+1],'sha256:'+'c'.repeat(64));
if(a[0]==='volume'&&a[1]==='create')console.log('b'.repeat(64));
if(a[0]==='run'&&process.env.TEST_INIT_FAIL==='1')process.exit(42);
if(a[0]==='create')fs.writeFileSync(p.join(r,'mode'),a.includes('REQUIRE_PREWARMED_FONTS=0')?'cold':'warm');
const mode=fs.existsSync(p.join(r,'mode'))?fs.readFileSync(p.join(r,'mode'),'utf8'):'warm';
const status=Number(process.env[mode==='cold'?'TEST_COLD_STATUS':'TEST_WARM_STATUS']||0);
if(a[0]==='start')process.exit(status);
if(a[0]==='cp'){
 const o=a[2];fs.mkdirSync(p.join(o,'previews'),{recursive:true});fs.mkdirSync(p.join(o,'svg/objects'),{recursive:true});
 fs.writeFileSync(p.join(o,'compile.log'),'RENDERER_METRIC stage=compile elapsed_seconds=1 memory_peak_bytes=1234\\n'+(status===84?'renderer: memory limit exceeded\\n':''));
 if(status===0)for(const f of ['result.pdf','previews/page-1.png','svg/manifest.json','svg/objects/math.svg'])fs.writeFileSync(p.join(o,f),'fixture');
}
`,
        { mode: 0o700 },
      );
      const result = spawnSync(
        "sh",
        ["deploy/scripts/ci-font-cache-benchmark.sh", "fixture-runtime"],
        {
          encoding: "utf8",
          timeout: 15000,
          env: {
            ...process.env,
            PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`,
            TMPDIR: join(root, "tmp"),
            GITHUB_ACTIONS: "true",
            RUNNER_ENVIRONMENT: "github-hosted",
            GITHUB_STEP_SUMMARY: "",
            TEST_ROOT: root,
            ...extra,
          },
        },
      );
      return { root, result, trace: readFileSync(join(root, "trace"), "utf8") };
    }
    it("runs only warm validation for ordinary daily builds", () => {
      const f = fixture();
      expect(f.result.status, f.result.stderr).toBe(0);
      expect(f.result.stdout).toContain("mode=warm ");
      expect(f.trace).not.toContain('"build"');
      expect(readdirSync(join(f.root, "tmp"))).toEqual([]);
    });
    it("compares a confirmed cold OOM and two successful warm runs without keeping temporary data", () => {
      const f = fixture({ CI_FONT_CACHE_COMPARE: "1", TEST_COLD_STATUS: "84" });
      expect(f.result.status, f.result.stderr).toBe(0);
      for (const mode of ["cold", "warm", "warm-repeat"])
        expect(f.result.stdout).toContain("mode=" + mode + " ");
      expect(f.trace).toContain('"image","rm","sha256:');
      expect(readdirSync(join(f.root, "tmp"))).toEqual([]);
    });
    it.each([
      { CI_FONT_CACHE_COMPARE: "1", TEST_COLD_STATUS: "42" },
      { CI_FONT_CACHE_COMPARE: "0", TEST_WARM_STATUS: "84" },
      { CI_FONT_CACHE_COMPARE: "0", TEST_INIT_FAIL: "1" },
    ])(
      "does not accept an unverified baseline or failed warm run: %j",
      (extra) => {
        const f = fixture(extra);
        expect(f.result.status).toBe(65);
        expect(readdirSync(join(f.root, "tmp"))).toEqual([]);
      },
    );
  },
);
