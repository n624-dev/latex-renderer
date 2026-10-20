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
if(a[0]==='create')fs.writeFileSync(p.join(r,'mode'),a.includes('LATEX_RENDER_STAGE=preview')?'preview':a.includes('REQUIRE_PREWARMED_FONTS=0')?'cold':a.includes('RENDERER_LUA_GC_MODE=standard')?'standard':'warm');
const mode=fs.existsSync(p.join(r,'mode'))?fs.readFileSync(p.join(r,'mode'),'utf8'):'warm';
let status=Number(process.env[mode==='cold'?'TEST_COLD_STATUS':'TEST_WARM_STATUS']||0);
if(a[0]==='create'&&mode==='preview'){
 const mount=a.find(v=>v.startsWith('type=bind,src=')&&v.includes(',dst=/work/pdf,'));
 if(!mount)throw new Error('Missing preview PDF input');
 const input=mount.slice('type=bind,src='.length).split(',dst=')[0];
 // docker cp preserves private output modes, but the next sandbox uses UID
 // 10000. Model both traversal and file-read permission, not just existence.
 const readable=Boolean(fs.statSync(input).mode&1)&&Boolean(fs.statSync(p.join(input,'result.pdf')).mode&4);
 fs.writeFileSync(p.join(r,'preview-readable'),readable?'yes':'no');
}
if(mode==='preview'&&fs.readFileSync(p.join(r,'preview-readable'),'utf8')!=='yes')status=1;
if(mode==='preview'&&process.env.TEST_PREVIEW_FAIL==='1')status=42;
if(a[0]==='start')process.exit(status);
if(a[0]==='cp'){
 const o=a[2];fs.mkdirSync(p.join(o,'previews'),{recursive:true});fs.mkdirSync(p.join(o,'svg/objects'),{recursive:true});
 fs.chmodSync(o,0o700);
 fs.writeFileSync(p.join(o,'compile.log'),'RENDERER_METRIC stage=compile elapsed_seconds=1 memory_peak_bytes=1234\\n'+(status===84?'renderer: memory limit exceeded\\n':''));
 if(status===0)for(const f of ['result.pdf','previews/page-1.png','svg/manifest.json','svg/objects/math.svg',...(mode==='preview'?['previews/page-2.png']:[])]){
  fs.writeFileSync(p.join(o,f),(process.env.TEST_DIFFERENT_PNG==='1'&&mode==='warm'&&f==='previews/page-1.png')||(process.env.TEST_DIFFERENT_PAGE_TWO==='1'&&mode==='preview'&&o.endsWith('warm-page-2')&&f==='previews/page-2.png')?'different':'fixture',{mode:0o660});
 }
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
      expect(f.trace).toContain("RENDERER_LUA_GC_MODE=standard");
      expect(f.trace).not.toContain("RENDERER_LUA_GC_MODE=balanced");
      expect(f.trace).not.toContain('"build"');
      expect(readdirSync(join(f.root, "tmp"))).toEqual([]);
    });
    it("keeps the production collector at standard behavior unless comparison is requested", () => {
      const compile = readFileSync("renderer/compile.sh", "utf8");
      expect(compile).toContain("${RENDERER_LUA_GC_MODE:-standard}");
    });
    it("compares a confirmed cold OOM and two successful warm runs without keeping temporary data", () => {
      const f = fixture({ CI_FONT_CACHE_COMPARE: "1", TEST_COLD_STATUS: "84" });
      expect(f.result.status, f.result.stderr).toBe(0);
      for (const mode of ["cold", "standard", "warm", "warm-repeat"])
        expect(f.result.stdout).toContain("mode=" + mode + " ");
      expect(f.trace).toContain("RENDERER_LUA_GC_MODE=standard");
      expect(f.trace).toContain("RENDERER_LUA_GC_MODE=balanced");
      expect(f.trace).toContain("LATEX_PREVIEW_PAGE=2");
      expect(f.trace).toContain("dst=/work/pdf,readonly");
      // The same measured peak in every mode must still pass this comparison.
      expect(f.result.stdout).toContain("peak_bytes=1234");
      expect(f.trace).toContain('"image","rm","sha256:');
      expect(readdirSync(join(f.root, "tmp"))).toEqual([]);
    });
    it.each([
      { CI_FONT_CACHE_COMPARE: "1", TEST_COLD_STATUS: "42" },
      { CI_FONT_CACHE_COMPARE: "0", TEST_WARM_STATUS: "84" },
      { CI_FONT_CACHE_COMPARE: "0", TEST_INIT_FAIL: "1" },
      { CI_FONT_CACHE_COMPARE: "1", TEST_DIFFERENT_PNG: "1" },
      { CI_FONT_CACHE_COMPARE: "1", TEST_DIFFERENT_PAGE_TWO: "1" },
      { CI_FONT_CACHE_COMPARE: "1", TEST_PREVIEW_FAIL: "1" },
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
