import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, win32 } from "node:path";

/** ASCII-only CMD source: Unicode/%/!/quotes in install paths stay in data, not
 * command source. Execute the bundled entry with normal Node argv semantics. */
export function windowsLauncherContents(
  installDirectory: string,
  binDirectory: string,
  name: "latex-render" | "latex-renderer-mcp",
): string {
  const encoded = Buffer.from(
    JSON.stringify({
      install: installDirectory,
      bin: binDirectory,
      entry: win32.join(installDirectory, "app", `${name}.cjs`),
      cli: win32.join(binDirectory, "latex-render.cmd"),
    }),
  ).toString("base64");
  const script = `const c=JSON.parse(Buffer.from('${encoded}','base64').toString('utf8'));process.env.LATEX_RENDER_INSTALL_DIRECTORY=c.install;process.env.LATEX_RENDER_BIN_DIRECTORY=c.bin;process.env.LATEX_RENDER_CLI_PATH=c.cli;process.env.LATEX_RENDER_BASE_URL||='https://latex-render.n624.jp';process.argv.splice(1,0,c.entry);require(c.entry)`;
  return `@echo off\r\n@rem latex-renderer managed external launcher v1\r\nsetlocal DisableDelayedExpansion\r\nnode -e "${script}" -- %*\r\n`;
}

export function hasExternalWindowsBin(
  installDirectory: string,
  binDirectory: string,
): boolean {
  return (
    win32.resolve(installDirectory, "bin").toLowerCase() !==
    win32.resolve(binDirectory).toLowerCase()
  );
}

export async function manageWindowsLaunchers(
  installDirectory: string,
  binDirectory: string,
  remove = false,
): Promise<{ repaired: string[]; preserved: string[] }> {
  const result = { repaired: [] as string[], preserved: [] as string[] };
  if (!hasExternalWindowsBin(installDirectory, binDirectory)) return result;
  if (!remove) await mkdir(binDirectory, { recursive: true });
  for (const name of ["latex-render", "latex-renderer-mcp"] as const) {
    const destination = join(binDirectory, `${name}.cmd`),
      expected = windowsLauncherContents(installDirectory, binDirectory, name);
    const info = await lstat(destination).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    });
    if (info === undefined) {
      if (!remove) {
        // Exclusive creation never overwrites another install/user's launcher.
        await writeFile(destination, expected, { flag: "wx", mode: 0o600 });
        result.repaired.push(`launcher:${name}`);
      }
    } else if (
      info.isFile() &&
      info.nlink === 1 &&
      info.size < 16_384 &&
      (await readFile(destination, "utf8")) === expected
    ) {
      if (remove) await rm(destination);
    } else result.preserved.push(`launcher:${name}`);
  }
  return result;
}
