import { execFile, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";
import { clientSetupFailureDiagnostic } from "../packages/setup-core/src/failure-diagnostic.js";
import {
  deploymentJsonDiagnostic,
  runDeploymentJsonCheck,
} from "../deploy/scripts/deployment-json-check.mjs";

const roots: string[] = [];
const runner = resolve("deploy/scripts/deployment-json-check.mjs");
const exec = promisify(execFile);
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "deployment-json ' ; $() "));
  roots.push(root);
  return root;
}
const request = (script: string, options = {}) =>
  runDeploymentJsonCheck(process.execPath, ["-e", script], {
    timeoutMs: 2000,
    killGraceMs: 100,
    ...options,
  });

describe("bounded deployment JSON receipts", () => {
  it.each([
    ["process.stdout.write('{\"success\":true}');", 0, undefined],
    [
      "process.stdout.write('{\"success\":true}');process.exitCode=17;",
      17,
      "child-exit",
    ],
    ["process.stdout.write('{\"success\":false}');", 1, "reported-failure"],
    ["process.stdout.write('private malformed input');", 1, "invalid-json"],
    ["process.stdout.write('null');", 1, "invalid-json"],
    ["process.stdout.write('[]');", 1, "invalid-json"],
    [
      'process.stdout.write(\'{"success":true,"apiKey":"private"}\');',
      1,
      "sensitive-output",
    ],
    [
      'process.stdout.write(\'{"success":true,"ticket":"lrk_private"}\');',
      1,
      "sensitive-output",
    ],
  ])(
    "keeps child status and fails closed: %s",
    async (script, status, reason) => {
      const result = await request(script);
      expect(result.exitCode).toBe(status);
      if (reason) {
        expect(result.diagnostic?.reason).toBe(reason);
        expect(result).not.toHaveProperty("output");
        expect(JSON.stringify(result)).not.toContain("private");
      } else expect(result.output).toBe('{"success":true}');
    },
  );

  it.each(["stdout", "stderr"])(
    "bounds %s even if a TERM handler exits zero",
    async (stream) => {
      const result = await request(
        `process.on('SIGTERM',()=>process.exit(0));process.${stream}.write('private'.repeat(20000));setInterval(()=>{},1000);`,
      );
      expect(result).toEqual({
        exitCode: 125,
        diagnostic: { reason: "output-limit" },
      });
    },
  );

  it("does not turn a deadline or failed spawn into success", async () => {
    expect(
      await request(
        "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);",
        { timeoutMs: 250 },
      ),
    ).toEqual({ exitCode: 124, diagnostic: { reason: "timeout" } });
    expect(
      await runDeploymentJsonCheck("/nonexistent-private-fixture-command", []),
    ).toEqual({ exitCode: 126, diagnostic: { reason: "spawn-failed" } });
  });

  it("rejects deeply nested JSON without leaking a parser or serialization exception", async () => {
    const result = await request(
      `process.stdout.write('{"success":true,"nested":'+'['.repeat(12000)+'0'+']'.repeat(12000)+'}');`,
    );
    expect(result).toEqual({
      exitCode: 1,
      diagnostic: { reason: "invalid-json" },
    });
  });

  it("checks JSON depth without counting escaped quotes or brackets inside strings", async () => {
    const atLimit =
      '{"success":true,"nested":' + "[".repeat(31) + "0" + "]".repeat(31) + "}";
    const overLimit =
      '{"success":true,"nested":' + "[".repeat(32) + "0" + "]".repeat(32) + "}";
    expect(
      (await request(`process.stdout.write(${JSON.stringify(atLimit)});`))
        .exitCode,
    ).toBe(0);
    expect(
      (await request(`process.stdout.write(${JSON.stringify(overLimit)});`))
        .exitCode,
    ).toBe(1);
    const text = JSON.stringify({
      success: true,
      value: '\\"{[}]'.repeat(100),
    });
    expect(
      (await request(`process.stdout.write(${JSON.stringify(text)});`))
        .exitCode,
    ).toBe(0);
  });

  it("counts both streams together and accepts a JSON receipt at the byte boundary", async () => {
    const output = JSON.stringify({ success: true, value: "あ" });
    expect(
      (
        await request(`process.stdout.write(${JSON.stringify(output)});`, {
          maxOutputBytes: Buffer.byteLength(output),
        })
      ).exitCode,
    ).toBe(0);
    expect(
      await request(
        `process.stdout.write(${JSON.stringify(output)});process.stderr.write('x');`,
        { maxOutputBytes: Buffer.byteLength(output) },
      ),
    ).toEqual({ exitCode: 125, diagnostic: { reason: "output-limit" } });
  });

  it.skipIf(process.platform === "win32")(
    "preserves child signals",
    async () => {
      expect(await request("process.kill(process.pid,'SIGTERM');")).toEqual({
        exitCode: 143,
        diagnostic: { reason: "child-exit" },
      });
    },
  );

  it.skipIf(process.platform !== "linux")(
    "stops a wrapper's TERM-ignoring descendant before returning",
    async () => {
      const root = await fixture();
      const pidPath = join(root, "descendant-pid");
      const child = `require('node:fs').writeFileSync(${JSON.stringify(pidPath)},String(process.pid));process.on('SIGTERM',()=>{});process.stdout.write('x'.repeat(65537));setInterval(()=>{},1000);`;
      const parent = `const {spawn}=require('node:child_process');spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'inherit'});process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);`;
      expect((await request(parent, { timeoutMs: 5000 })).exitCode).toBe(125);
      const pid = Number(await readFile(pidPath, "utf8"));
      expect(pid).toBeGreaterThan(1);
      const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "");
      const state = stat
        ? (stat.slice(stat.lastIndexOf(") ") + 2).split(" ")[0] ?? "")
        : "";
      expect(["", "Z", "X"]).toContain(state);
    },
  );

  it("logs only allowlisted hints, including legacy HTTP, integrity and errno failures", () => {
    expect(
      deploymentJsonDiagnostic({
        error: {
          code: "SETUP_FAILED",
          message: "Manifest download failed: HTTP 503",
          diagnostic: { phase: "distribution", systemCode: "EAI_AGAIN" },
        },
      }),
    ).toEqual({
      code: "SETUP_FAILED",
      phase: "distribution",
      systemCode: "EAI_AGAIN",
      category: "manifest-http",
      httpStatus: 503,
    });
    for (const [message, expected] of [
      [
        "Archive download failed: HTTP 404",
        { category: "archive-http", httpStatus: 404 },
      ],
      [
        "Client archive SHA-256 verification failed",
        { category: "archive-verification" },
      ],
      ["Client manifest is invalid", { category: "invalid-manifest" }],
      [
        "Archive response exceeds the 26214400-byte download limit",
        { category: "download-body" },
      ],
      ["EACCES: private path, token=private", { systemCode: "EACCES" }],
      ["fetch failed", { category: "network-fetch" }],
      ["Manifest download failed: HTTP 503 private", {}],
      [
        "apiKey=private uploadTicket=private jobTicket=private cookie=private https://private/?token=private\nstack /private",
        {},
      ],
    ] as const)
      expect(deploymentJsonDiagnostic({ error: { message } })).toEqual(
        expected,
      );
    expect(
      deploymentJsonDiagnostic({
        error: {
          code: "PRIVATE",
          diagnostic: { phase: "PRIVATE", systemCode: "PRIVATE" },
          message: "private",
        },
      }),
    ).toEqual({});
  });

  it("finds bounded allowlisted causal codes without serializing causes or cycles", () => {
    for (const code of [
      "ENOSPC",
      "EACCES",
      "ENOTFOUND",
      "UND_ERR_CONNECT_TIMEOUT",
      "ERR_TLS_CERT_ALTNAME_INVALID",
    ]) {
      const diagnostic = clientSetupFailureDiagnostic(
        new Error("private message", {
          cause: Object.assign(new Error("private cause"), { code }),
        }),
      );
      expect(diagnostic).toEqual({ systemCode: code });
      expect(deploymentJsonDiagnostic({ error: { diagnostic } })).toEqual(
        diagnostic,
      );
    }
    const cycle: { cause?: unknown; code: string } = { code: "PRIVATE" };
    cycle.cause = cycle;
    expect(clientSetupFailureDiagnostic(cycle)).toEqual({});
    expect(
      clientSetupFailureDiagnostic({
        cause: { code: "PRIVATE", message: "private" },
      }),
    ).toEqual({});
  });

  it("keeps the client hint allowlist aligned with the independent log boundary", async () => {
    const lists = await Promise.all(
      [
        "packages/setup-core/src/failure-diagnostic.ts",
        "deploy/scripts/deployment-json-check.mjs",
      ].map(async (path) => {
        const source = await readFile(path, "utf8");
        const body =
          /const systemCodes = new Set\(\[([\s\S]*?)\]\);/.exec(source)?.[1] ??
          "";
        return Array.from(
          body.matchAll(/"([A-Z0-9_]+)"/g),
          (match) => match[1],
        );
      }),
    );
    expect(lists[0]?.length).toBeGreaterThan(20);
    expect(lists[0]).toEqual(lists[1]);
  });

  it.each([
    { timeoutMs: 0 },
    { timeoutMs: 120001 },
    { maxOutputBytes: 65537 },
    { maxOutputBytes: -1 },
    { killGraceMs: 1001 },
  ])("rejects invalid limits before spawning: %j", async (options) => {
    await expect(request("process.exitCode=0", options)).rejects.toThrow(
      "Invalid deployment JSON check limits",
    );
  });

  it("preserves diagnostics through cleanup without retaining raw failure output", async () => {
    const root = await fixture();
    const source = await readFile(
      "deploy/scripts/deploy-production-release.sh",
      "utf8",
    );
    const cleanup = source.slice(
      source.indexOf("cleanup() {"),
      source.indexOf("\nenvironment_file="),
    );
    const result = spawnSync(
      "/bin/sh",
      ["-s", "--", root, process.cwd(), process.execPath],
      {
        input: `set -eu
source_root=$2
. "$source_root/deploy/scripts/deployment-checks.sh"
temporary_root=$1
client_smoke_root=
gateway_runtime_config=
admin_local_root=
mcpb_verify_root=
deployment_quiesced=true
deployment_finished=false
restore_services_after_failure() { echo fixture-services-restored; }
${cleanup}
deployment_checkpoint client-install
deployment_json "$temporary_root/setup.json" "$3" -e 'process.stdout.write(JSON.stringify({success:false,error:{code:"SETUP_FAILED",message:"fetch failed",diagnostic:{phase:"distribution",systemCode:"ECONNRESET"},private:"lrk_private"}}));process.stderr.write("private-cookie");process.exitCode=17;'
echo should-not-run
`,
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(17);
    expect(result.stderr).toContain('"systemCode":"ECONNRESET"');
    expect(result.stderr).toContain('"code":"SETUP_FAILED"');
    expect(result.stderr).toContain(
      "Deployment failed: step=client-install exit=17",
    );
    expect(result.stderr).not.toMatch(/private|lrk_|cookie/);
    expect(result.stdout.trim()).toBe("fixture-services-restored");
    expect(existsSync(root)).toBe(false);
  });

  it("creates only exclusive private success receipts and rejects an existing symlink", async () => {
    const root = await fixture();
    const output = join(root, "receipt.json");
    await exec(process.execPath, [
      runner,
      "client-doctor",
      output,
      process.execPath,
      "-e",
      "process.stdout.write('{\"success\":true}');",
    ]);
    expect(await readFile(output, "utf8")).toBe('{"success":true}');
    const target = join(root, "private-target");
    await writeFile(target, "unchanged");
    await symlink(target, join(root, "link"));
    await expect(
      exec(process.execPath, [
        runner,
        "client-uninstall",
        join(root, "link"),
        process.execPath,
        "-e",
        "process.stdout.write('{\"success\":true}');",
      ]),
    ).rejects.toMatchObject({ code: 1 });
    expect(await readFile(target, "utf8")).toBe("unchanged");
  });

  it("bundles the downloadable installer with safe nested network hints", async () => {
    const root = await fixture();
    const installer = join(root, "install.mjs");
    await build({
      entryPoints: ["client/install.ts"],
      outfile: installer,
      bundle: true,
      platform: "node",
      format: "esm",
      alias: {
        "@latex-renderer/setup-core": resolve(
          "packages/setup-core/src/index.ts",
        ),
        "@latex-renderer/shared": resolve("packages/shared/src/index.ts"),
      },
      logLevel: "silent",
    });
    const preload = join(root, "preload.mjs");
    await writeFile(
      preload,
      "globalThis.fetch=async()=>{throw new TypeError('fetch failed',{cause:Object.assign(new Error('private network'),{code:'ENOTFOUND'})});};",
    );
    const result = await runDeploymentJsonCheck(process.execPath, [
      "--import",
      preload,
      installer,
      "--base-uri",
      "https://example.invalid/private?token=private",
      "--skill-target",
      "none",
      "--mcp-target",
      "none",
      "--json",
    ]);
    expect(result).toEqual({
      exitCode: 1,
      diagnostic: {
        reason: "child-exit",
        category: "network-fetch",
        code: "SETUP_FAILED",
        phase: "distribution",
        systemCode: "ENOTFOUND",
      },
    });
    const usage = await runDeploymentJsonCheck(process.execPath, [
      "--import",
      preload,
      installer,
      "--skill-target",
      "invalid",
      "--json",
    ]);
    expect(usage).toEqual({
      exitCode: 1,
      diagnostic: {
        reason: "child-exit",
        code: "SETUP_FAILED",
        phase: "arguments",
      },
    });
    expect(await readFile("deploy/updater-files.json", "utf8")).toContain(
      "deploy/scripts/deployment-json-check.mjs",
    );
  });

  it("requires the real packaged-client check in both native CI jobs and signed workflows", async () => {
    const ci = await readFile(".github/workflows/ci.yml", "utf8");
    expect(ci.match(/pnpm test:client:deployment/g)).toHaveLength(2);
    for (const path of [
      ".github/workflows/server-release.yml",
      ".github/workflows/server-update-validation.yml",
    ])
      expect(await readFile(path, "utf8")).toContain(
        "pnpm test:client:deployment",
      );
  });

  it("keeps privileged success receipts outside the non-root installer tree", async () => {
    const source = await readFile(
      "deploy/scripts/deploy-production-release.sh",
      "utf8",
    );
    for (const name of ["setup", "doctor", "remove"])
      expect(source).toContain(
        `deployment_json "$temporary_root/client-${name}.json"`,
      );
    expect(source).not.toMatch(
      /\$client_smoke_root\/(?:setup|doctor|remove)\.json/,
    );
  });
});
