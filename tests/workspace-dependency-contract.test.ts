import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

// Root tsconfig path aliases can hide an undeclared workspace dependency.
// Check source imports (including type-only import expressions) independently
// of the installer's hoisting and the order of recursive builds.
it("declares internal package imports in every production workspace", () => {
  const missing: string[] = [];
  for (const parent of ["apps", "packages"]) {
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const root = join(parent, entry.name),
        manifestPath = join(root, "package.json"),
        src = join(root, "src");
      if (!existsSync(manifestPath) || !existsSync(src)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        name: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      const declared = new Set([
        manifest.name,
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
      ]);
      const pending = [src];
      while (pending.length) {
        const directory = pending.pop();
        if (directory === undefined) break;
        for (const child of readdirSync(directory, { withFileTypes: true })) {
          const file = join(directory, child.name);
          if (child.isDirectory()) pending.push(file);
          else if (
            child.isFile() &&
            /\.(?:ts|mts)$/.test(child.name) &&
            !child.name.endsWith(".test.ts")
          ) {
            const source = readFileSync(file, "utf8");
            const names = new Set(
              [
                ...source.matchAll(
                  /(?:from\s*|import\(\s*)["'](@latex-renderer\/[^"'/]+)[^"']*["']/g,
                ),
              ].map((match) => match[1]),
            );
            for (const name of names)
              if (name !== undefined && !declared.has(name))
                missing.push(`${relative(process.cwd(), file)}: ${name}`);
          }
        }
      }
    }
  }
  expect(missing).toEqual([]);
});
