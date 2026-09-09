import { execFile, spawnSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const exec = promisify(execFile);
const helper = resolve("deploy/scripts/deployment-checks.sh");
const script = await readFile(
  "deploy/scripts/deploy-production-release.sh",
  "utf8",
);

it.each([
  ["complete", 0, ""],
  ["missing", 1, "expected-content-missing"],
  ["redirect", 1, "http_status=302"],
  ["unavailable", 1, "http_status=503"],
  ["partial", 1, "curl_exit=18"],
  ["oversized", 1, "curl_exit=63"],
])(
  "checks real HTTP transfers with dash: %s",
  async (kind, exitCode, diagnostic) => {
    const root = await mkdtemp(join(tmpdir(), "deployment-http-test-"));
    const server = createServer((_request, response) => {
      const body =
        kind === "missing"
          ? "private-response-value"
          : "literal.[marker] private-response-value";
      response.statusCode =
        kind === "redirect" ? 302 : kind === "unavailable" ? 503 : 200;
      if (kind === "redirect")
        response.setHeader("Location", "/private-location");
      if (kind === "partial" || kind === "oversized") {
        response.setHeader(
          "Content-Length",
          kind === "partial" ? body.length + 100 : 4194305,
        );
        response.setHeader("Connection", "close");
      }
      response.end(body);
    });
    try {
      // Quotes, spaces and shell metacharacters must remain literal path data.
      const copiedHelper = join(root, "helper ' ; $() ` literal.sh");
      await copyFile(helper, copiedHelper);
      await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("no fixture address");
      const result = await exec("/bin/sh", [
        "tests/fixtures/deployment-http-check.sh",
        copiedHelper,
        root,
        `http://127.0.0.1:${address.port}/?secret=private-query-value`,
      ]).then(
        (value) => ({ ...value, code: 0 }),
        (error: unknown) => {
          if (
            !(error instanceof Error) ||
            !("code" in error) ||
            typeof error.code !== "number" ||
            !("stdout" in error) ||
            typeof error.stdout !== "string" ||
            !("stderr" in error) ||
            typeof error.stderr !== "string"
          )
            throw error;
          return {
            code: error.code,
            stdout: error.stdout,
            stderr: error.stderr,
          };
        },
      );
      expect(result.code).toBe(exitCode);
      expect(result.stderr).toContain("Deployment check: fixture-http");
      if (diagnostic) {
        expect(result.stderr).toContain(diagnostic);
        expect(result.stderr).toContain(
          "Deployment failed: step=fixture-http exit=1",
        );
      }
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toMatch(/private-|127\.0\.0\.1|secret=/);
      if (kind === "partial") {
        // Reproduce the old false-positive behavior, not the unexplained RC1
        // failure: dash reports grep's success despite curl's truncated transfer.
        await expect(
          exec("/bin/sh", [
            "-c",
            'curl --fail --silent --max-time 2 "$1" | grep -Fq "literal.[marker]"',
            "fixture",
            `http://127.0.0.1:${address.port}/`,
          ]),
        ).resolves.toMatchObject({ stdout: "" });
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("keeps bounded requests, literal matching and the signed helper in the updater envelope", async () => {
  const source = await readFile(helper, "utf8");
  expect(source).toContain("--connect-timeout 10 --max-time 30");
  expect(source).toContain("--max-filesize 4194304");
  expect(source).toContain("grep -Fq --");
  expect(script).not.toMatch(/curl[^\n]*\|\s*grep/);
  expect(
    JSON.parse(await readFile("deploy/updater-files.json", "utf8")),
  ).toContain("deploy/scripts/deployment-checks.sh");
});

it.each([
  ["exit 7", 7],
  ["kill -TERM $$", 143],
  ["kill -INT $$", 130],
  ["kill -HUP $$", 129],
  ["rm() { return 9; }; exit 7", 7],
])(
  "preserves failure status and restores services: %s",
  (command, expected) => {
    // Run the production cleanup and traps, but replace destructive/privileged
    // commands with shell functions. No root, service or production path access.
    const cleanup = script.slice(
      script.indexOf("cleanup() {"),
      script.indexOf("\nenvironment_file="),
    );
    const result = spawnSync(
      "/bin/sh",
      [
        "-c",
        `
    set -eu
    . "$1"
    temporary_root=fixture
    gateway_runtime_config=
    admin_local_root=
    client_smoke_root=
    mcpb_verify_root=
    deployment_quiesced=true
    deployment_finished=false
    rm() { :; }
    restore_services_after_failure() { echo fixture-services-restored; }
    ${cleanup}
    deployment_checkpoint client-doctor
    ${command}
    echo should-not-run
  `,
        "fixture",
        helper,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(expected);
    expect(result.stderr).toContain(
      `Deployment failed: step=client-doctor exit=${expected}`,
    );
    expect(result.stdout.trim()).toBe("fixture-services-restored");
  },
);

it("labels each previously silent post-MCPB check before executing it", () => {
  for (const [label, command] of [
    [
      "public-installer-content",
      'deployment_expect_body "$client_base/install.mjs',
    ],
    [
      "public-downloads-content",
      'deployment_expect_body "$public_origin/downloads/',
    ],
    [
      "client-install",
      'runuser -u "$sync_user" -- /usr/local/bin/node "$client_smoke_root/client-install.mjs"',
    ],
    [
      "client-doctor",
      'runuser -u "$sync_user" -- env PATH="$client_smoke_root/bin:$PATH"',
    ],
    ["client-install-doctor-json", "/usr/local/bin/node -e '"],
    [
      "client-uninstall",
      'runuser -u "$sync_user" -- /usr/local/bin/node "$client_smoke_root/client-uninstall.mjs"',
    ],
    ["client-uninstall-json", "/usr/local/bin/node -e '"],
    ["client-uninstall-directory", 'test ! -e "$client_smoke_root/client"'],
    ["local-home", "deployment_expect_body http://127.0.0.1:3101/ "],
    ["local-admin", "deployment_expect_body http://127.0.0.1:3101/admin/ "],
    [
      "local-tex",
      "deployment_expect_body http://127.0.0.1:3101/admin/tex-environment/ ",
    ],
    ["local-health", "deployment_expect_body http://127.0.0.1:3104/health "],
  ])
    expect(script).toContain(`deployment_checkpoint ${label}\n${command}`);
});
