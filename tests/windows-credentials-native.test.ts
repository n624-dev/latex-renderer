import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Writable } from "node:stream";
import { expect, it } from "vitest";
import yazl from "yazl";
import {
  doctorSetup,
  installDistribution,
  loadCredential,
  resolveSetupPaths,
} from "../packages/setup-core/src/index.js";

it.runIf(process.platform === "win32")(
  "uses existing DPAPI credentials through PowerShell 7 -> Node -> Windows PowerShell",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-renderer-dpapi-"));
    const secret = `lrk_${"a".repeat(32)}_${"B".repeat(43)}`;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      APPDATA: join(root, "config"),
      LOCALAPPDATA: join(root, "local"),
    };
    delete env.LATEX_RENDER_API_KEY;
    const paths = resolveSetupPaths({ platform: "win32", home: root, env });
    const winps = join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const cleanEnv = Object.fromEntries(
      Object.entries(env).filter(
        ([key]) => key.toLowerCase() !== "psmodulepath",
      ),
    );
    function checked(
      command: string,
      args: string[],
      options: { env: NodeJS.ProcessEnv; input?: string },
    ) {
      const value = spawnSync(command, args, {
        ...options,
        encoding: "utf8",
        timeout: 30_000,
        windowsHide: true,
      });
      // Never attach raw child output or credentials to a failed assertion.
      assert.equal(
        value.error === undefined,
        true,
        "Credential fixture process must start",
      );
      assert.equal(value.status, 0, "Credential fixture process must succeed");
      return value;
    }
    try {
      await mkdir(dirname(paths.credentialPath), { recursive: true });
      // Generate the pre-fix ConvertFrom-SecureString file, not a new format.
      checked(
        winps,
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$ErrorActionPreference='Stop';$s=[Console]::In.ReadToEnd().Trim();$v=ConvertTo-SecureString $s -AsPlainText -Force;$e=ConvertFrom-SecureString $v;[IO.File]::WriteAllText($env:LR_CREDENTIAL_PATH,$e,[Text.Encoding]::ASCII)",
        ],
        {
          env: { ...cleanEnv, LR_CREDENTIAL_PATH: paths.credentialPath },
          input: secret,
        },
      );
      const original = await readFile(paths.credentialPath);
      const child = join(root, "child.mjs");
      const module = pathToFileURL(
        resolve("packages/setup-core/dist/index.js"),
      ).href;
      await writeFile(
        child,
        `import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadCredential,saveCredential,resolveSetupPaths} from ${JSON.stringify(module)};
const expected=await new Promise(resolve=>{let s='';process.stdin.on('data',v=>s+=v);process.stdin.on('end',()=>resolve(s));});
assert(process.env.PSModulePath.startsWith(process.env.LR_TEST_PS7_MODULES+';'),'PS7 modules must be inherited before Windows PowerShell modules');
const path=resolveSetupPaths().credentialPath,before=await readFile(path);
assert(await loadCredential()===expected,'Existing DPAPI credential must load');
assert((await readFile(path)).equals(before),'Reading must not rewrite the legacy credential');
await saveCredential(expected);
assert(await loadCredential()===expected,'New DPAPI credential must round-trip');
process.stdout.write('credential-roundtrip-ok');
`,
      );
      const throughPs7 = checked(
        "pwsh.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$env:LR_TEST_PS7_MODULES=[IO.Path]::Combine($PSHOME,'Modules');$env:PSModulePath=$env:LR_TEST_PS7_MODULES+';'+$env:PSModulePath; & $env:LR_TEST_NODE $env:LR_TEST_SCRIPT; exit $LASTEXITCODE",
        ],
        {
          env: {
            ...env,
            LR_TEST_NODE: process.execPath,
            LR_TEST_SCRIPT: child,
          },
          input: secret,
        },
      );
      assert.equal(
        throughPs7.stdout.trim(),
        "credential-roundtrip-ok",
        "Only the success marker may be emitted",
      );
      assert.equal(
        throughPs7.stderr.trim(),
        "",
        "Credential probes must not emit diagnostics on success",
      );
      expect(await loadCredential({ home: root, env })).toBe(secret);

      const sink = new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      });
      const archive = new yazl.ZipFile();
      for (const name of [
        "app/latex-render.cjs",
        "app/latex-renderer-mcp.cjs",
        "bin/latex-render.cmd",
        "bin/latex-renderer-mcp.cmd",
        "skill/scripts/install-skill.mjs",
      ])
        archive.addBuffer(
          Buffer.from("fixture"),
          `latex-renderer-client/${name}`,
        );
      archive.end();
      const chunks: Buffer[] = [];
      for await (const chunk of archive.outputStream)
        chunks.push(chunk as Buffer);
      const bytes = Buffer.concat(chunks);
      const { createHash } = await import("node:crypto");
      const options = {
        platform: "win32" as const,
        home: root,
        env,
        installDirectory: join(root, "install"),
        runner: () => ({ status: 0, stdout: "", stderr: "" }),
        output: sink,
        warning: sink,
      };
      await installDistribution({
        ...options,
        archive: bytes,
        manifest: {
          version: "0.2.0",
          archive: "latex-renderer-client-0.2.0.zip",
          size: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
        skillTarget: "none",
        mcpTarget: "none",
      });
      const healthy = await doctorSetup(options);
      expect(
        healthy.checks.find((check) => check.id === "credential")?.status,
      ).toBe("pass");
      expect(JSON.stringify(healthy)).not.toContain(secret);
      await writeFile(paths.credentialPath, "invalid DPAPI data");
      await expect(loadCredential({ home: root, env })).rejects.toMatchObject({
        code: "CREDENTIAL_DECRYPT_FAILED",
      });
      const degraded = await doctorSetup(options);
      expect(degraded.status).toBe("degraded");
      const credentialCheck = degraded.checks.find(
        (check) => check.id === "credential",
      );
      expect(credentialCheck?.status).toBe("fail");
      expect(credentialCheck?.message).toContain("CREDENTIAL_DECRYPT_FAILED");
      expect(JSON.stringify(degraded)).not.toContain(secret);
      await rm(paths.credentialPath);
      await expect(loadCredential({ home: root, env })).rejects.toMatchObject({
        code: "CREDENTIAL_NOT_FOUND",
      });
      assert(original.length > 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  120_000,
);
