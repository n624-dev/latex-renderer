# LaTeX rules

- Use LuaLaTeX. Keep `main.tex` as the default root entrypoint, or use the user-selected relative `.tex` entrypoint without renaming it.
- Do not treat every `.tex` file as an independent document. Files included with `\\input` or `\\include` may be fragments.
- For Japanese text, prefer `luatexja` and Harano Aji fonts.
- Prefer TikZ and pgfplots for reproducible diagrams and graphs.
- Use raster/PDF images only for figures that are impractical to reproduce.
- Allowed project file types are `.tex`, `.sty`, `.cls`, `.bib`, `.bst`, `.csv`, `.dat`, `.txt`, `.png`, `.jpg`, `.jpeg`, and `.pdf`.
- Do not require shell escape, minted, gnuplot execution, Inkscape conversion, Python, SVG auto-conversion, another TeX engine, or a custom compilation command.
- Keep generated files out of the source tree; `.render/` is output-only.

## Reviewing composition

- Use the requested paper size and preserve the existing document class where practical. Adjust heading size, weight, and spacing as a hierarchy.
- Configure Japanese text, Latin text, and mathematics independently. When changing just one family, compare both the formulas and the new body text with the prior PDF.
- Investigate unexpected horizontal gaps in source order: explicit spaces and glue, boxes and alignment, then inter-script spacing and justification. Check similar formulas after the fix.
- For a large blank area near a page break, inspect the block that moved to the next page. Check forced breaks, unbreakable boxes, long equations, and float placement. Split at meaningful boundaries and retain nearby headings.
- Check labels, units, alignment, line weights, and scale in plots, tables, and circuit diagrams. Preserve their content when improving their layout.
