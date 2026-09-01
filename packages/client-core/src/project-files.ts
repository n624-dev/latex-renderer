const generatedLatexSuffixes = [
  ".aux",
  ".bbl",
  ".bcf",
  ".blg",
  ".dvi",
  ".fdb_latexmk",
  ".fls",
  ".lof",
  ".log",
  ".lot",
  ".nav",
  ".out",
  ".run.xml",
  ".snm",
  ".synctex",
  ".synctex.gz",
  ".toc",
  ".vrb",
  ".xdv",
] as const;

export function shouldExcludeProjectPath(name: string): boolean {
  const normalized = name.replaceAll("\\", "/");
  const lower = normalized.toLowerCase();
  return (
    normalized === ".render" ||
    normalized.startsWith(".render/") ||
    normalized === ".git" ||
    normalized.startsWith(".git/") ||
    normalized === ".latexrenderignore" ||
    normalized === "node_modules" ||
    normalized.startsWith("node_modules/") ||
    normalized === ".env" ||
    normalized.startsWith(".env.") ||
    normalized === "credentials.json" ||
    normalized.startsWith("credentials.") ||
    normalized === ".npmrc" ||
    normalized === ".netrc" ||
    normalized === ".aws" ||
    normalized.startsWith(".aws/") ||
    normalized === ".ssh" ||
    normalized.startsWith(".ssh/") ||
    normalized === ".idea" ||
    normalized.startsWith(".idea/") ||
    normalized === ".vscode" ||
    normalized.startsWith(".vscode/") ||
    [".pem", ".key", ".p12", ".pfx"].some((suffix) => lower.endsWith(suffix)) ||
    generatedLatexSuffixes.some((suffix) => lower.endsWith(suffix))
  );
}
