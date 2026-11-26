export function syncFile(path: string): Promise<void>;
export function syncDirectory(path: string): Promise<void>;
export function syncPublishedAncestors(path: string, root: string): Promise<void>;
export function syncArtifactTree(root: string, files: readonly string[]): Promise<void>;
