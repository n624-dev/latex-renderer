# Tagged Japanese PDF

Use a tagged PDF when the reader needs to navigate text by headings, interpret figures and tables, or read in an order that follows the document structure. Ask for the intended use before choosing a format.

Check the connected Runtime for a verified tagged profile. The Japanese template uses LuaLaTeX, the Japanese collection, and the `article` class. Test package compatibility before changing the class or packages in an existing document. Keep the original saved revision.

- Use real headings and lists. Check that the reading order follows the argument.
- Describe informative figures in the context of the adjacent text. Identify decorative graphics as such. Check alt text against the original figure.
- Identify data-table headers, including when a table spans pages.
- Review how fractions, subscripts, integrals, and matrices are represented and read.
- Record the exact PDF digest. Keep machine checks, checks in a reader or assistive technology, and comparison with the original content separate.

The [Japanese example](../assets/japanese-tagged.tex) is also available as the `japanese-tagged` guide topic. A renderer that reports this profile can generate and mechanically check tagged output for its tested fixture. PDF/UA conformance and the reading order of a new document require their own checks.

See the [LaTeX Project tagging instructions](https://tagging-project.latex-project.org/documentation/usage-instructions).
