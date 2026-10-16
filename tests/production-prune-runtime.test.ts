import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const runtime = `sha256:${"a".repeat(64)}`;
const previous = `sha256:${"b".repeat(64)}`;
const base = `sha256:${"c".repeat(64)}`;
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function selection(
  state: unknown,
  options: { configured?: string; missing?: string; tag?: boolean } = {},
) {
  const root = await mkdtemp(join(process.cwd(), ".prune-fixture-"));
  roots.push(root);
  await chmod(root, 0o700);
  const statePath = join(root, "state.json"),
    calls = join(root, "calls");
  await writeFile(
    statePath,
    state === "malformed" ? "{" : JSON.stringify(state),
  );
  const source = await readFile(
    "deploy/scripts/prune-production-artifacts.sh",
    "utf8",
  );
  // Run only the production selection/admission fragment, never cleanup,
  // real Docker, root paths or the privileged shell entry point.
  const fragment = source.slice(
    source.indexOf("managed_current=\n"),
    source.indexOf("# Caller still owns"),
  );
  expect(fragment).toContain("image manager state is unreadable");
  const result = spawnSync(
    "sh",
    [
      "-c",
      `set -eu
rootless_docker() {
  [ "$1" = image ] && [ "$2" = inspect ] || return 99
  printf '%s\\n' "$3" >> "$calls"
  [ "$3" != "$missing" ] || return 1
  if [ "$3" = "$source_image" ]; then
    [ "$tag_present" = true ] || return 1
    printf '%s\\n' "$configured_image"
  fi
}
${fragment.replace("/usr/local/bin/node", '"$fixture_node"')}
printf 'active=%s protected=%s\\n' "$managed_active" "$managed_protected"
`,
    ],
    {
      encoding: "utf8",
      timeout: 10000,
      env: {
        PATH: process.env.PATH,
        fixture_node: process.execPath,
        image_manager_state: statePath,
        configured_image: options.configured ?? runtime,
        source_image: "latex-renderer:texlive-2026",
        missing: options.missing ?? "",
        tag_present: String(options.tag ?? false),
        calls,
      },
    },
  );
  return {
    ...result,
    calls: (await readFile(calls, "utf8").catch(() => ""))
      .trim()
      .split("\n")
      .filter(Boolean),
  };
}
describe("production cleanup protects recorded Runtime identities", () => {
  it("keeps arbitrarily tagged initial and previous Runtime IDs without requiring the fixed tag", async () => {
    const result = await selection({
      current: { legacy: true, runtimeImageId: runtime },
      previous: { legacy: true, runtimeImageId: previous, baseImageId: base },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("active=true protected=true");
    expect(result.calls).toEqual([runtime, previous, base]);
  });
  it("keeps non-legacy managed IDs", async () => {
    const result = await selection({
      current: { runtimeImageId: runtime },
      previous: { runtimeImageId: previous },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls).toEqual([runtime, previous]);
  });
  it("rejects a configured/recorded current mismatch", async () => {
    const result = await selection({
      current: { legacy: true, runtimeImageId: previous },
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toContain("does not match RENDERER_IMAGE");
  });
  it("refuses a missing protected previous image", async () => {
    const result = await selection(
      {
        current: { legacy: true, runtimeImageId: runtime },
        previous: { legacy: true, runtimeImageId: previous },
      },
      { missing: previous },
    );
    expect(result.status).toBe(78);
    expect(result.stderr).toContain("protected managed image is missing");
  });
  it("retains a previous recorded image when active state still uses the historical tag", async () => {
    const result = await selection(
      { current: null, previous: { legacy: true, runtimeImageId: previous } },
      { tag: true },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("active=false protected=true");
    expect(result.calls).toEqual(["latex-renderer:texlive-2026", previous]);
  });
  it("keeps the historical tag check only when no recorded current is available", async () => {
    const result = await selection(
      { current: null, previous: null },
      { tag: true },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("active=false protected=false");
    expect(result.calls).toEqual(["latex-renderer:texlive-2026"]);
    expect(
      (await selection({ current: null, previous: null })).status,
    ).not.toBe(0);
  });
  it.each(
    [
      "malformed",
      { current: { legacy: true, runtimeImageId: "--all" } },
      { current: { legacy: true } },
      [],
    ].map((state) => ({ state })),
  )("fails closed for invalid recorded state %j", async ({ state }) => {
    const result = await selection(state);
    expect(result.status).toBe(78);
    expect(result.stderr).toContain("state is unreadable");
  });
});
