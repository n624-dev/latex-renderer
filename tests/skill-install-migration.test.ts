import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installSkillTargets,
  removeSkillTargets,
  resolveSkillLocations,
} from "../integrations/latex-renderer/scripts/install-skill.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe("cross-platform Skill installation", () => {
  it("resolves canonical paths without binding to an operating system", () => {
    expect(resolveSkillLocations("/home/alice", path.posix)).toEqual({
      codex: "/home/alice/.agents/skills/latex-renderer",
      codexLegacy: "/home/alice/.codex/skills/latex-renderer",
      claude: "/home/alice/.claude/skills/latex-renderer",
    });
    expect(resolveSkillLocations("C:\\Users\\Alice", path.win32).codex).toBe(
      "C:\\Users\\Alice\\.agents\\skills\\latex-renderer",
    );
  });

  it("installs a fresh Codex Skill only at the canonical path", async () => {
    const fixture = await createFixture();
    const result = await installSkillTargets({
      target: "codex",
      source: fixture.current,
      home: fixture.home,
      ...quietOutput(),
    });

    expect(result).toMatchObject([{ status: "installed" }]);
    await expect(
      readFile(join(fixture.locations.codex, "SKILL.md"), "utf8"),
    ).resolves.toBe("current\n");
    await expect(readFile(fixture.locations.codexLegacy)).rejects.toThrow();
  });

  it("migrates an unchanged managed legacy Skill", async () => {
    const fixture = await createFixture();
    await cp(fixture.previous, fixture.locations.codexLegacy, {
      recursive: true,
    });

    const result = await installSkillTargets({
      target: "codex",
      source: fixture.current,
      previousSource: fixture.previous,
      home: fixture.home,
      ...quietOutput(),
    });

    expect(result).toMatchObject([{ status: "migrated" }]);
    await expect(
      readFile(join(fixture.locations.codex, "SKILL.md"), "utf8"),
    ).resolves.toBe("current\n");
    await expect(readFile(fixture.locations.codexLegacy)).rejects.toThrow();
  });

  it("preserves a user-modified legacy Skill and skips migration", async () => {
    const fixture = await createFixture();
    await cp(fixture.previous, fixture.locations.codexLegacy, {
      recursive: true,
    });
    await writeFile(
      join(fixture.locations.codexLegacy, "SKILL.md"),
      "user modified\n",
    );

    const result = await installSkillTargets({
      target: "codex",
      source: fixture.current,
      previousSource: fixture.previous,
      home: fixture.home,
      ...quietOutput(),
    });

    expect(result).toMatchObject([{ status: "preserved_modified_legacy" }]);
    await expect(
      readFile(join(fixture.locations.codexLegacy, "SKILL.md"), "utf8"),
    ).resolves.toBe("user modified\n");
    await expect(readFile(fixture.locations.codex)).rejects.toThrow();
  });

  it("updates an unchanged managed Skill and preserves later user changes", async () => {
    const fixture = await createFixture();
    await cp(fixture.previous, fixture.locations.codex, { recursive: true });
    const output = quietOutput();

    await expect(
      installSkillTargets({
        target: "codex",
        source: fixture.current,
        previousSource: fixture.previous,
        home: fixture.home,
        ...output,
      }),
    ).resolves.toMatchObject([{ status: "updated" }]);
    await writeFile(
      join(fixture.locations.codex, "SKILL.md"),
      "user modified\n",
    );
    await expect(
      removeSkillTargets({
        target: "codex",
        source: fixture.current,
        home: fixture.home,
        ...output,
      }),
    ).resolves.toMatchObject([{ status: "preserved_modified" }]);
    await expect(
      readFile(join(fixture.locations.codex, "SKILL.md"), "utf8"),
    ).resolves.toBe("user modified\n");
  });
});

async function createFixture(): Promise<{
  home: string;
  current: string;
  previous: string;
  locations: ReturnType<typeof resolveSkillLocations>;
}> {
  const root = await mkdtemp(join(tmpdir(), "latex-skill-test-"));
  temporaryRoots.push(root);
  const home = join(root, "home");
  const current = join(root, "current");
  const previous = join(root, "previous");
  await Promise.all([
    mkdir(current, { recursive: true }),
    mkdir(previous, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(current, "SKILL.md"), "current\n"),
    writeFile(join(previous, "SKILL.md"), "previous\n"),
  ]);
  return {
    home,
    current,
    previous,
    locations: resolveSkillLocations(home),
  };
}

function quietOutput(): {
  output: { write: (value: string) => unknown };
  warning: { write: (value: string) => unknown };
} {
  return {
    output: { write: vi.fn<(value: string) => unknown>() },
    warning: { write: vi.fn<(value: string) => unknown>() },
  };
}
