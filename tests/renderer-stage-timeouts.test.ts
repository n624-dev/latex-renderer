import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execute = promisify(execFile);

async function executable(path: string, body: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `#!/usr/bin/env node\n${body}\n`, { mode: 0o700 });
}

describe("renderer stage timeout exit codes", () => {
  it.each([
    ["compile", "pdf", 81, "LaTeX compile timed out"],
    ["pdfinfo", "pdf", 82, "PDF preview inspection timed out"],
    ["preview", "pdf", 82, "PDF preview timed out"],
    ["svg", "pdf,svg", 83, "SVG capture timed out"],
    ["svg-export", "pdf,svg", 83, "SVG conversion timed out"],
  ])(
    "maps %s/%s timeout to stage exit %i",
    async (stage, outputs, code, message) => {
      const root = await mkdtemp(join(tmpdir(), "renderer-timeout-fixture-"));
      try {
        const work = join(root, "work");
        const opt = join(root, "opt");
        const scratch = join(root, "tmp");
        const bin = join(root, "bin");
        await mkdir(join(work, "input"), { recursive: true });
        await mkdir(scratch);
        await mkdir(
          join(opt, "texlive/2026/texmf-var/luatex-cache/generic/names"),
          {
            recursive: true,
          },
        );
        await writeFile(join(work, "input/main.tex"), "fixture");
        await executable(
          join(bin, "timeout"),
          `const {spawnSync}=require('node:child_process');
const args=process.argv.slice(2);
let i=0;
while (i<args.length && args[i].startsWith('-')) {
  if (args[i]==='-s'||args[i]==='-k') i+=2;
  else i++;
}
i++;
const command=args[i], commandArgs=args.slice(i+1);
const stage=process.env.TEST_TIMEOUT_STAGE;
if ((stage==='compile' && command==='latexmk' && !commandArgs.includes('-jobname=objects')) ||
    (stage==='pdfinfo' && command==='pdfinfo') ||
    (stage==='preview' && command==='pdftoppm') ||
    (stage==='svg' && command==='latexmk' && commandArgs.includes('-jobname=objects')) ||
    (stage==='svg-export' && command.endsWith('/export-svg.pl')))
  process.exit(124);
const result=spawnSync(command,commandArgs,{stdio:'inherit',env:process.env});
process.exit(result.status??125);`,
        );
        await executable(
          join(bin, "latexmk"),
          `const fs=require('node:fs'), path=require('node:path');
const args=process.argv.slice(2);
const out=args.find(x=>x.startsWith('-outdir=')).slice(8);
const name=args.find(x=>x.startsWith('-jobname='))?.slice(9)??'main';
fs.writeFileSync(path.join(out,name+'.pdf'),'%PDF-1.4\\n');
fs.writeFileSync(path.join(out,name+'.synctex.gz'),'map');
if(name==='objects') fs.writeFileSync(path.join(out,'objects.meta'),'capture metadata');`,
        );
        await executable(join(bin, "pdfinfo"), "console.log('Pages: 1');");
        await executable(
          join(bin, "pdftoppm"),
          "require('node:fs').writeFileSync(process.argv.at(-1)+'-1.png','preview');",
        );
        await executable(
          join(opt, "renderer/export-svg.pl"),
          "process.exit(0);",
        );
        const original = await readFile(
          new URL("../renderer/compile.sh", import.meta.url),
          "utf8",
        );
        const prefixes: Record<string, string> = {
          "/work": work,
          "/opt": opt,
          "/tmp": scratch,
        };
        const script = original.replace(
          /\/(?:work|opt|tmp)\b/g,
          (prefix) => prefixes[prefix] as string,
        );
        const scriptPath = join(root, "compile.sh");
        await writeFile(scriptPath, script);
        await expect(
          execute("sh", [scriptPath], {
            timeout: 10_000,
            env: {
              ...process.env,
              PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
              LATEX_ENTRYPOINT: "main.tex",
              LATEX_OUTPUTS: outputs,
              TEST_TIMEOUT_STAGE: stage,
            },
          }),
        ).rejects.toMatchObject({ code });
        expect(
          await readFile(join(work, "output/compile.log"), "utf8"),
        ).toContain(message);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
