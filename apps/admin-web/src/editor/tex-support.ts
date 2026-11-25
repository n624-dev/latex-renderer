import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import {
  defaultHighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { search, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";

const tex = StreamLanguage.define(stex);
const commands = [
  "begin",
  "end",
  "documentclass",
  "usepackage",
  "input",
  "include",
  "section",
  "subsection",
  "chapter",
  "paragraph",
  "label",
  "ref",
  "pageref",
  "cite",
  "bibliography",
  "bibliographystyle",
  "includegraphics",
  "caption",
  "item",
  "textbf",
  "textit",
  "emph",
  "frac",
  "sqrt",
  "left",
  "right",
  "newcommand",
  "renewcommand",
  "newenvironment",
  "setlength",
  "maketitle",
].map((command) => ({ label: `\\${command}`, type: "keyword" }));

const texEditing: Extension = [
  tex,
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  EditorState.languageData.of(() => [
    { closeBrackets: { brackets: ["(", "[", "{"] } },
  ]),
  closeBrackets(),
  keymap.of(closeBracketsKeymap),
  autocompletion({
    override: [
      (context) => {
        const command = context.matchBefore(/\\[a-zA-Z]*/);
        return command
          ? { from: command.from, options: commands, validFor: /^\\[a-zA-Z]*$/ }
          : null;
      },
    ],
  }),
];

export function editorTools(path: string): Extension {
  return [
    search({ top: true }),
    keymap.of(searchKeymap),
    /\.(?:tex|sty|cls)$/i.test(path) ? texEditing : [],
  ];
}
