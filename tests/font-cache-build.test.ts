import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
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
  "immutable font cache preparation",
  () => {
    function fixture() {
      const root = mkdtempSync(join(tmpdir(), "font-cache-build-"));
      roots.push(root);
      for (const d of ["bin", "tmp", "texlive"]) mkdirSync(join(root, d));
      const script = join(root, "install.sh");
      writeFileSync(
        script,
        readFileSync(
          "renderer/install-language-packages.sh",
          "utf8",
        ).replaceAll("/opt/texlive/2026", join(root, "texlive")),
      );
      writeFileSync(
        join(root, "bin/kpsewhich"),
        '#!/bin/sh\ncase "$1" in Harano*) [ "$TEST_MISSING_JAPANESE" != 1 ] ;; *) [ "$TEST_MISSING_LATIN" != 1 ] ;; esac\n',
        { mode: 0o700 },
      );
      writeFileSync(
        join(root, "bin/lualatex"),
        `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const text=fs.readFileSync('warm.tex','utf8');
const font=/newfontface[^\\n]*\\{([^}]+)\\}/.exec(text)[1];
fs.appendFileSync(process.env.TEST_TRACE,font+'\\n');
if(process.env.TEST_FAIL_FONT===font)process.exit(42);
const cache=path.join(process.env.TEXMFVAR,'luatex-cache/generic/fonts/otl');
fs.mkdirSync(cache,{recursive:true});fs.writeFileSync(path.join(cache,font+'.luc'),'fixture');
`,
        { mode: 0o700 },
      );
      return {
        root,
        run: (env: Record<string, string> = {}) =>
          spawnSync("sh", [script, "--warm-font-cache"], {
            encoding: "utf8",
            timeout: 10000,
            env: {
              ...process.env,
              PATH: join(root, "bin") + ":" + process.env.PATH,
              TMPDIR: join(root, "tmp"),
              TEST_TRACE: join(root, "trace"),
              ...env,
            },
          }),
      };
    }
    it("loads one face per invocation, includes default Japanese medium, and cleans staging", () => {
      const f = fixture(),
        result = f.run();
      expect(result.status, result.stderr).toBe(0);
      const fonts = readFileSync(join(f.root, "trace"), "utf8")
        .trim()
        .split("\n");
      expect(fonts).toHaveLength(6);
      expect(new Set(fonts).size).toBe(6);
      expect(fonts).toContain("HaranoAjiGothic-Medium.otf");
      expect(
        statSync(
          join(
            f.root,
            "texlive/texmf-var/luatex-cache/generic/fonts/otl/lmroman10-regular.otf.luc",
          ),
        ).mode & 0o777,
      ).toBe(0o644);
      expect(readdirSync(join(f.root, "tmp"))).toEqual([]);
    });
    it("supports a non-Japanese Runtime without pretending a missing Latin font is valid", () => {
      const f = fixture();
      expect(f.run({ TEST_MISSING_JAPANESE: "1" }).status).toBe(0);
      expect(readFileSync(join(f.root, "trace"), "utf8").trim()).toBe(
        "lmroman10-regular.otf",
      );
      expect(f.run({ TEST_MISSING_LATIN: "1" }).status).toBe(65);
      expect(readdirSync(join(f.root, "tmp"))).toEqual([]);
    });
    it("fails the image layer and cleans temporary files if a face cannot load", () => {
      const f = fixture();
      expect(
        f.run({ TEST_FAIL_FONT: "HaranoAjiMincho-Regular.otf" }).status,
      ).toBe(65);
      expect(readdirSync(join(f.root, "tmp"))).toEqual([]);
    });
  },
);
