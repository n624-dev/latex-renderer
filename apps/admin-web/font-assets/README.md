# Web fonts

The common stylesheet prefers installed Inter. The Japanese, Simplified Chinese, and Korean pages also prefer the installed Noto Sans family for that language. The same-origin web fonts fill in when the browser cannot use the local families. The browser loads the appropriate regional stylesheet and fetches font files according to their Unicode ranges.

The font files and stylesheets include a content hash in their names. The public static build copies the same assets that the Web service serves. Both include the upstream Open Font License notices. The font assets affect Web UI and guide typography. TeX source uses the editor's monospace stack, and generated PDFs use the fonts selected by the document.

## Regenerate the assets

Use FontTools 4.61.1 with Brotli 1.2.0. Download these files into one directory and pass it to `generate.py`. The script checks the SHA-256 of each source.

- `Inter-4.1.zip` from the [Inter 4.1 release](https://github.com/rsms/inter/releases/tag/v4.1).
- `NotoSansJP-VF.ttf`, `NotoSansSC-VF.ttf`, and `NotoSansKR-VF.ttf` from [Noto Sans CJK 2.004](https://github.com/notofonts/noto-cjk/tree/523d033d6cb47f4a80c58a35753646f5c3608a78/Sans/Variable/TTF/Subset).
- `Noto-OFL.txt` from the [Noto Sans CJK license](https://github.com/notofonts/noto-cjk/blob/523d033d6cb47f4a80c58a35753646f5c3608a78/LICENSE).

```sh
python3 apps/admin-web/font-assets/generate.py /path/to/sources /path/to/new-font-assets
```

Replace the generated files with the contents of the new directory. Inter separates Latin, Cyrillic, and other characters. Each Noto family has one subset for frequently used interface text, a second for the guides, and further subsets for the remaining glyphs. The generator uses the committed language catalogs and guides to choose those first two sets.
