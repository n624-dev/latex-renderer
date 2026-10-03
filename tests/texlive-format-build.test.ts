import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
type TraceRow = {
  event: string;
  engine?: string;
  pid?: number;
  args?: string[];
  active?: number;
};
function workerPid(row: TraceRow) {
  if (
    typeof row.pid !== "number" ||
    !Number.isSafeInteger(row.pid) ||
    row.pid <= 1 ||
    row.pid === process.pid
  )
    throw new Error("Invalid fixture PID");
  return row.pid;
}
function records(root: string): TraceRow[] {
  const trace = join(root, "trace");
  return existsSync(trace)
    ? readFileSync(trace, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as TraceRow)
    : [];
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    for (const row of records(root).filter(
      (row) => row.event === "start" || row.pid !== undefined,
    )) {
      try {
        process.kill(-workerPid(row), "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
});
function fixture(extra: Record<string, string> = {}, deadline?: number) {
  const root = mkdtempSync(join(tmpdir(), "texlive-format-fixture-"));
  roots.push(root);
  for (const dir of ["bin", "tmp", "active", "output"])
    mkdirSync(join(root, dir));
  const program = `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
const root = process.env.TEST_ROOT, args = process.argv.slice(2);
const log = row => fs.appendFileSync(path.join(root, 'trace'), JSON.stringify(row)+'\\n');
const formats = {pdftex: ['pdftex','pdflatex','latex'], luatex: ['luatex','lualatex'], xetex: ['xetex','xelatex']};
if (path.basename(process.argv[1]) === 'mktexlsr') {
  log({event:'index', active:fs.readdirSync(path.join(root,'active')).length, ...(process.env.TEST_INDEX_HANG === 'true' ? {pid:process.pid} : {})});
  if (process.env.TEST_INDEX_HANG === 'true') {process.on('SIGTERM',()=>{}); setInterval(()=>{},1000); await new Promise(()=>{});}
  process.exit(process.env.TEST_INDEX_FAIL === 'true' ? 42 : 0);
}
if (args[0] === '--listcfg') {
  if (process.env.TEST_LIST_FAIL === 'true') process.exit(42);
  if (process.env.TEST_BAD_CONFIG === 'true') {console.log('unknown configuration'); process.exit(0);}
  console.log('List of all formats:');
  if (process.env.TEST_EMPTY !== 'true') for (const [engine,names] of Object.entries(formats)) for (const name of names) {
    console.log(name+' (engine='+engine+') enabled\\n  hyphen=language.dat, args=-ini\\n  origin=/fixture/fmtutil.cnf');
  }
  console.log('disabled (engine=luatex) disabled\\n  hyphen=-, args=disabled.ini\\n  origin=/fixture/fmtutil.cnf');
  if (process.env.TEST_DUPLICATE === 'true') console.log('pdftex (engine=pdftex) enabled');
  process.exit(0);
}
if (args[0] === '--all') {log({event:'serial', args}); process.exit(process.env.TEST_SERIAL_FAIL === 'true' ? 42 : 0);}
const engine = args[args.indexOf('--byengine')+1], pid=process.pid;
const active = path.join(root,'active',String(pid));
fs.writeFileSync(active,engine);
log({event:'start', engine, pid, args, active:fs.readdirSync(path.join(root,'active')).length});
if (process.env.TEST_HANG === engine) { process.on('SIGTERM',()=>{}); setInterval(()=>{},1000); }
else setTimeout(()=>{
  fs.unlinkSync(active);
  if (process.env.TEST_FAIL === engine) {log({event:'failed',engine,pid}); process.exit(42);}
  if (process.env.TEST_SIGNAL === engine) { process.kill(pid,'SIGKILL'); return; }
  const status=args[args.indexOf('--status-file')+1];
  if (process.env.TEST_NO_STATUS === engine) process.exit(0);
  const rows=[];
  for (const name of formats[engine]) {
    fs.writeFileSync(path.join(root,'output',name+'.fmt'),engine);
    if (process.env.TEST_MISSING !== name) rows.push('SUCCESS '+name+' '+engine+' byengine '+engine);
  }
  rows.push('DISABLED disabled luatex byengine '+engine);
  rows.push('NOTSELECTED other other byengine '+engine);
  if (process.env.TEST_BAD_STATUS === engine) rows.push('NOTAVAIL unexpected '+engine);
  if (process.env.TEST_DUPLICATE_STATUS === engine) rows.push(rows[0]);
  fs.writeFileSync(status,rows.join('\\n')+'\\n');
  log({event:'done',engine,pid});
}, Number(process.env.TEST_DELAY || 300));
`;
  for (const name of ["fmtutil-sys", "mktexlsr"])
    writeFileSync(join(root, "bin", name), program, { mode: 0o700 });
  const env = {
    ...process.env,
    PATH: `${root}/bin:${process.env.PATH}`,
    TMPDIR: join(root, "tmp"),
    TEST_ROOT: root,
    TEXLIVE_FORMAT_JOBS: "2",
    ...extra,
  };
  let script = "renderer/install-language-packages.sh";
  if (deadline !== undefined) {
    const source = readFileSync(script, "utf8");
    expect(source).toContain("alarm 600;");
    script = join(root, "run.sh");
    writeFileSync(script, source.replace("alarm 600;", `alarm ${deadline};`));
  }
  const args = [script, "--rebuild-formats"];
  const run = () =>
    spawnSync("sh", args, { env, encoding: "utf8", timeout: 10000 });
  return { root, env, args, run };
}
describe.skipIf(process.platform === "win32")(
  "bounded standard format generation",
  () => {
    it("defaults to the serial baseline when no concurrency is configured", () => {
      const f = fixture();
      delete (f.env as Record<string, string | undefined>).TEXLIVE_FORMAT_JOBS;
      const result = f.run();
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(records(f.root)).toEqual([{ event: "serial", args: ["--all"] }]);
    });
    it.each(["2", "4"])(
      "rebuilds every enabled format with at most %s workers and a single final index writer",
      (jobs) => {
        const f = fixture({ TEXLIVE_FORMAT_JOBS: jobs }),
          result = f.run();
        expect(result.error, result.stderr).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain(
          `TEXLIVE_FORMAT_PLAN engines=3 formats=7 jobs=${jobs}`,
        );
        expect(result.stdout).toContain("TEXLIVE_FORMAT_COMPLETED formats=7");
        const trace = records(f.root),
          starts = trace.filter((row) => row.event === "start");
        expect(starts.map((row) => row.engine).sort()).toEqual([
          "luatex",
          "pdftex",
          "xetex",
        ]);
        for (const row of starts) {
          expect(row.args).toContain("--nohash");
          expect(row.args).toContain("--strict");
          expect(row.active).toBeLessThanOrEqual(Number(jobs));
        }
        expect(
          Math.max(...starts.map((row) => row.active ?? 0)),
        ).toBeGreaterThan(1);
        expect(trace.filter((row) => row.event === "index")).toEqual([
          { event: "index", active: 0 },
        ]);
        expect(trace.at(-1)?.event).toBe("index");
        expect(readdirSync(join(f.root, "output")).sort()).toEqual([
          "latex.fmt",
          "lualatex.fmt",
          "luatex.fmt",
          "pdflatex.fmt",
          "pdftex.fmt",
          "xelatex.fmt",
          "xetex.fmt",
        ]);
        expect(readdirSync(join(f.root, "tmp"))).toEqual([]);
      },
    );
    it.each(["false", "true"])(
      "keeps the exact serial --all path and exit status (failure=%s)",
      (failure) => {
        const f = fixture({
            TEXLIVE_FORMAT_JOBS: "1",
            TEST_SERIAL_FAIL: failure,
          }),
          result = f.run();
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(failure === "true" ? 42 : 0);
        expect(records(f.root)).toEqual([{ event: "serial", args: ["--all"] }]);
      },
    );
    it.each(["0", "3", "8", "-1", "2; echo unsafe"])(
      "rejects invalid concurrency %s before running commands",
      (jobs) => {
        const f = fixture({ TEXLIVE_FORMAT_JOBS: jobs }),
          result = f.run();
        expect(result.status).toBe(64);
        expect(records(f.root)).toEqual([]);
      },
    );
    it.each([
      { TEST_LIST_FAIL: "true" },
      { TEST_BAD_CONFIG: "true" },
      { TEST_EMPTY: "true" },
      { TEST_DUPLICATE: "true" },
      { TEST_FAIL: "luatex", TEST_HANG: "pdftex" },
      { TEST_SIGNAL: "luatex" },
      { TEST_MISSING: "lualatex" },
      { TEST_NO_STATUS: "luatex" },
      { TEST_BAD_STATUS: "luatex" },
      { TEST_DUPLICATE_STATUS: "luatex" },
    ])("fails closed and cleans workers/status files for %j", (env) => {
      const f = fixture(env),
        result = f.run();
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain("TEXLIVE_FORMAT_COMPLETED");
      const trace = records(f.root);
      expect(trace.some((row) => row.event === "index")).toBe(false);
      if ("TEST_HANG" in env)
        expect(
          trace.some((row) => row.event === "start" && row.engine === "pdftex"),
        ).toBe(true);
      for (const row of trace.filter((row) => row.event === "start"))
        expect(() => process.kill(workerPid(row), 0)).toThrow();
      expect(readdirSync(join(f.root, "tmp"))).toEqual([]);
    });
    it("keeps final index failure fatal", () => {
      const f = fixture({ TEST_INDEX_FAIL: "true" }),
        result = f.run();
      expect(result.status).not.toBe(0);
      expect(records(f.root).at(-1)?.event).toBe("index");
    });
    it("bounds the parallel phase and reaps TERM-ignoring requests on deadline", () => {
      const f = fixture({ TEST_HANG: "luatex", TEST_DELAY: "30000" }, 1),
        result = f.run();
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("deadline exceeded");
      const trace = records(f.root);
      expect(trace.filter((row) => row.event === "start")).toHaveLength(2);
      for (const row of trace.filter((row) => row.event === "start"))
        expect(() => process.kill(workerPid(row), 0)).toThrow();
      expect(trace.some((row) => row.event === "index")).toBe(false);
      expect(readdirSync(join(f.root, "tmp"))).toEqual([]);
    });
    it("also bounds and reaps a stuck final index writer", () => {
      const f = fixture({ TEST_INDEX_HANG: "true", TEST_DELAY: "50" }, 1),
        result = f.run();
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("deadline exceeded");
      const index = records(f.root).find((row) => row.event === "index");
      if (!index) throw new Error("Index writer did not start");
      expect(index.active).toBe(0);
      expect(() => process.kill(workerPid(index), 0)).toThrow();
      expect(readdirSync(join(f.root, "tmp"))).toEqual([]);
    });
    it("terminates and reaps worker process groups on interruption", async () => {
      const f = fixture({ TEST_HANG: "luatex", TEST_DELAY: "1000" });
      const child = spawn("sh", f.args, {
        env: f.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const closed = new Promise<number | null>((resolve) =>
        child.once("close", resolve),
      );
      try {
        const deadline = Date.now() + 3000;
        while (
          records(f.root).filter((row) => row.event === "start").length < 2
        ) {
          if (Date.now() > deadline)
            throw new Error("Fixture workers did not start");
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        child.kill("SIGTERM");
        let watchdog: ReturnType<typeof setTimeout> | undefined;
        try {
          expect(
            await Promise.race([
              closed,
              new Promise<never>((_, reject) => {
                watchdog = setTimeout(
                  () => reject(new Error("Format supervisor did not exit")),
                  3000,
                );
              }),
            ]),
          ).not.toBe(0);
        } finally {
          clearTimeout(watchdog);
        }
        for (const row of records(f.root).filter(
          (row) => row.event === "start",
        ))
          expect(() => process.kill(workerPid(row), 0)).toThrow();
        expect(readdirSync(join(f.root, "tmp"))).toEqual([]);
        expect(records(f.root).some((row) => row.event === "index")).toBe(
          false,
        );
      } finally {
        child.kill("SIGKILL");
      }
    });
  },
);
