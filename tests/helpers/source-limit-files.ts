export function sourceLimitFiles(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    path: index === 0 ? "main.tex" : `章/part-${index}.tex`,
    text: "% 日本語\n",
  }));
}
