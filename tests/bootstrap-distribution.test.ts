import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

const helper = readFileSync("deploy/scripts/update-manager-helper.mjs", "utf8");
const buildFunction = helper
  .slice(
    helper.indexOf("export async function buildBootstrapRelease"),
    helper.indexOf("async function sealControlTree"),
  )
  .replace(/^export /, "");

async function build(failStatic = false) {
  const calls: string[] = [];
  // Execute the real orchestration without running privileged commands.
  const result = runInNewContext(
    `${buildFunction}; buildBootstrapRelease(
    '/stage', '/verified', 'pnpm@11.24.0',
    {uid: '1001', gid: '1002', deployUser: 'builder'})`,
    {
      join,
      mkdir: async () => {},
      chmod: async () => {},
      runCapture: () => Promise.resolve("11.24.0"),
      runLogged: (
        command: string,
        args: string[],
        options?: { uid: number; gid: number; cwd: string },
      ) => {
        calls.push(`${command} ${args.join(" ")}`);
        if (args.some((arg) => arg.endsWith("apps/public-web/build.mjs"))) {
          expect(command).toBe("/usr/local/bin/node");
          expect(options).toMatchObject({
            uid: 1001,
            gid: 1002,
            cwd: "/stage/bootstrap-build",
          });
          if (failStatic) throw new Error("static generation failed");
        }
      },
      assembleBuildArtifacts: () => {
        calls.push("assemble");
      },
      sealControlTree: () => {
        calls.push("seal");
      },
    },
  ) as Promise<string>;
  if (failStatic)
    await expect(result).rejects.toThrow("static generation failed");
  else expect(await result).toBe("/stage/assembly");
  return calls;
}

it("generates legacy distribution paths non-root after client build and before sealing", async () => {
  const calls = await build();
  const clients = calls.findIndex((call) => call.endsWith(" build:client"));
  const assets = calls.findIndex((call) =>
    call.endsWith("/apps/public-web/build.mjs"),
  );
  expect(clients).toBeGreaterThanOrEqual(0);
  expect(assets).toBeGreaterThan(clients);
  expect(calls.indexOf("assemble")).toBeGreaterThan(assets);
  expect(calls.at(-1)).toBe("seal");
  expect(calls.filter((call) => call.endsWith(" build:client"))).toHaveLength(
    1,
  );
  expect(calls.join("\n")).not.toMatch(/wrangler|build:assets/);
});

it("does not assemble or seal incomplete legacy distribution assets", async () => {
  const calls = await build(true);
  expect(calls).not.toContain("assemble");
  expect(calls).not.toContain("seal");
});

it.each([
  ["standalone", "client-dist/manifest.json", "client-dist/mcpb.json"],
  [
    "cloudflare",
    "apps/public-web/dist/downloads/client/manifest.json",
    "apps/public-web/dist/downloads/mcpb/mcpb.json",
  ],
])("selects both verification manifests for %s", (mode, client, mcpb) => {
  const driver = readFileSync(
    "deploy/scripts/deploy-production-release.sh",
    "utf8",
  );
  const selection = driver.slice(
    driver.indexOf(
      'if [ "$deployment_mode" = standalone ]; then',
      driver.indexOf('client_base="$public_origin/downloads/client"'),
    ),
    driver.indexOf('archive_path="$temporary_root/client-archive.zip"'),
  );
  const result = spawnSync(
    "bash",
    [
      "-eu",
      "-c",
      `${selection}\nprintf '%s\\n' "$local_manifest_path" "$local_mcpb_manifest_path"`,
    ],
    {
      env: {
        ...process.env,
        deployment_mode: mode,
        build_root: "/fresh build",
      },
      encoding: "utf8",
    },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim().split("\n")).toEqual([
    `/fresh build/${client}`,
    `/fresh build/${mcpb}`,
  ]);
  expect(driver).toContain('"$mcpb_base" "$local_mcpb_manifest_path"');
  expect(driver).toContain(
    '"$mcpb_verify_root/latex-renderer-local.mcpb" \\\n  "$local_mcpb_manifest_path"',
  );
});
