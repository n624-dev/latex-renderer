// Exercise the real handoff with explicitly private metadata. Hosted runner
// filesystem ACLs need not match a freshly installed application host.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, lstat, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export async function verifyPrivateMcpbHandoff({
  assembly,
  stage,
  publishedRoot,
  identity,
}) {
  assert.equal(process.getuid(), 0);
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
  assert.match(
    stage,
    /^\/opt\/latex-renderer\/update-staging\/ci-deploy-[A-Za-z0-9]+$/,
  );
  const run = (program, args, options = {}) =>
    execFileSync(program, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60000,
      ...options,
    });
  const applicationGid = Number(
    run("/usr/bin/id", ["-g", "latex-renderer"]).trim(),
  );
  const groups = run("/usr/bin/id", ["-G", identity.deployUser])
    .trim()
    .split(/\s+/);
  assert(!groups.includes(String(applicationGid)));
  const published = join(publishedRoot, "client-dist/mcpb.json");
  const info = await lstat(published);
  assert.equal(info.uid, 0);
  assert.equal(info.gid, applicationGid);
  assert.equal(info.mode & 0o007, 0);
  console.log(
    JSON.stringify({
      event: "ci.mcpb_publication_permissions",
      uid: info.uid,
      gid: info.gid,
      mode: info.mode & 0o777,
      acl: run("/usr/bin/getfacl", ["-cp", published]),
    }),
  );
  const metadata = await readFile(published, "utf8");
  const original = JSON.parse(metadata);
  assert.match(
    original.archive,
    /^latex-renderer-local-\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?\.mcpb$/,
  );
  const privateRoot = join(stage, "private-published");
  await mkdir(privateRoot, { mode: 0o700 });
  await copyFile(published, join(privateRoot, "mcpb.json"));
  run("/usr/sbin/runuser", [
    "-u",
    identity.deployUser,
    "--",
    "/usr/local/bin/node",
    "--input-type=module",
    "-e",
    'import { readFileSync } from "node:fs"; try { readFileSync(process.argv[1]); throw new Error("Private metadata unexpectedly readable"); } catch (error) { if (error.code !== "EACCES") throw error; }',
    join(privateRoot, "mcpb.json"),
  ]);
  const downloaded = join(stage, "handoff-download");
  await mkdir(downloaded, { mode: 0o700 });
  await copyFile(
    join(publishedRoot, "client-dist", original.archive),
    join(downloaded, "latex-renderer-local.mcpb"),
  );
  // Seal only this unpublished CI assembly for the same user that will run the
  // verifier. The deployment helper applies these same ownership boundaries.
  run("/usr/bin/chown", ["-hR", `0:${identity.gid}`, assembly]);
  run("/usr/bin/chmod", ["-R", "u=rwX,g=rX,o=", assembly]);
  run("/usr/bin/chown", [`0:${identity.gid}`, stage]);
  run("/usr/bin/chmod", ["0710", stage]);
  const script = await readFile(
    join(assembly, "deploy/scripts/deploy-production-release.sh"),
    "utf8",
  );
  const start = script.indexOf("mcpb_verify_root=$(mktemp");
  const end = script.indexOf('cache_buster="release=', start);
  assert(start >= 0 && end > start);
  run(
    "/bin/sh",
    [
      "-eu",
      "-c",
      `
    mcpb_verify_root=
    trap '[ -z "$mcpb_verify_root" ] || rm -rf -- "$mcpb_verify_root"' EXIT
    ${script.slice(start, end)}
  `,
    ],
    {
      env: {
        ...process.env,
        source_root: assembly,
        temporary_root: downloaded,
        local_mcpb_manifest_path: join(privateRoot, "mcpb.json"),
        sync_user: identity.deployUser,
        sync_group: identity.gid,
      },
    },
  );
  assert.equal(await readFile(published, "utf8"), metadata);
  return {
    deploymentUserOutsideApplicationGroup: true,
    privateMetadataAccessDenied: true,
    privateMetadataHandoff: true,
  };
}
