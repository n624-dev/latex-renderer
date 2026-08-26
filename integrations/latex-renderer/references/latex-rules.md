# LaTeX rules

- Use LuaLaTeX. Keep `main.tex` as the default root entrypoint, or use the user-selected relative `.tex` entrypoint without renaming it.
- Do not treat every `.tex` file as an independent document. Files included with `\\input` or `\\include` may be fragments.
- For Japanese text, prefer `luatexja` and Harano Aji fonts.
- Prefer TikZ and pgfplots for reproducible diagrams and graphs.
- Use raster/PDF images only for figures that are impractical to reproduce.
- Allowed project file types are `.tex`, `.sty`, `.cls`, `.bib`, `.csv`, `.dat`, `.txt`, `.png`, `.jpg`, `.jpeg`, and `.pdf`.
- Do not require shell escape, minted, gnuplot execution, Inkscape conversion, Python, SVG auto-conversion, another TeX engine, or a custom compilation command.
- Keep generated files out of the source tree; `.render/` is output-only.
