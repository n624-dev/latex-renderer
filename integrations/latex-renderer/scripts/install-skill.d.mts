export interface SkillLocations {
  codex: string;
  codexLegacy: string;
  claude: string;
}

export interface SkillResult {
  name: string;
  destination: string;
  legacy?: string;
  status:
    | "current"
    | "installed"
    | "updated"
    | "migrated"
    | "removed"
    | "preserved_modified"
    | "preserved_modified_legacy";
}

export interface SkillOptions {
  target: "codex" | "claude" | "both";
  source?: string;
  previousSource?: string;
  home?: string;
  output?: { write(value: string): unknown };
  warning?: { write(value: string): unknown };
}

export const bundledSkillRoot: string;
export function resolveSkillLocations(
  home: string,
  pathApi?: { join(...paths: string[]): string },
): SkillLocations;
export function installSkillTargets(
  options: SkillOptions,
): Promise<SkillResult[]>;
export function removeSkillTargets(
  options: SkillOptions,
): Promise<SkillResult[]>;
