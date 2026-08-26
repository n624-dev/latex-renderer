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
    generatedLatexSuffixes.some((suffix) => lower.endsWith(suffix))
  );
}
