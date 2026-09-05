export const requiredProductionBuildOutputs: readonly string[];

export function assembleBuildArtifacts(options: {
  verifiedSource: string;
  buildSource: string;
  assembly: string;
  runCommand: (command: string, args: string[]) => void | Promise<void>;
}): Promise<void>;

export function assertContainedSymlinks(
  root: string,
  directory: string,
): Promise<void>;

export function assertSealedControlTree(
  root: string,
  expectedUid?: number,
): Promise<void>;
