export const english = {
  skipContent: "Skip to content",
  appNavigation: "Application navigation",
  appRender: "Convert to PDF",
  appHistory: "History",
  appProjects: "Projects",
  appEnvironment: "Rendering environment",
  appAdmin: "Administration",
  appLogout: "Sign out",
  themeSystem: "System",
  themeLight: "Light",
  themeDark: "Dark",
  themeLabel: "Theme: {theme}",
  themeLabelAria: "Change theme. Current theme: {theme}",
  back: "Back to project",
  title: "TeX editor",
  language: "Display language",
  file: "File",
  engine: "Engine",
  template: "Template",
  chooseTemplate: "Choose a template",
  article: "Article",
  report: "Report",
  japaneseDocument: "Japanese document",
  autoCompile: "Auto compile",
  compile: "Compile",
  cancel: "Cancel",
  addFile: "Add text file",
  attachFile: "Attach a file",
  renameFile: "Rename file",
  deleteFile: "Delete file",
  setMain: "Set as main document",
  revisionOutputs: "Outputs for the saved revision",
  saveRevision: "Save a revision",
  loading: "Loading…",
  editorWidth: "Editor width",
  editorView: "Editor view",
  code: "Code",
  errors: "Errors",
  searchReplace: "Search and replace",
  zoom: "Zoom",
  fitWidth: "Fit width",
  format: "Preview format",
  lightweightPng: "PNG (lightweight preview)",
  previousPage: "Previous page",
  nextPage: "Next page",
  downloadPdf: "Save PDF",
  buildLog: "Compile result and log",
  noErrors: "No compile errors.",
  confirmReplace: "Replace the current draft with this revision?",
  mainFile: "{path} (main)",
  stalePdf: "Showing draft {version}. Recent edits are not in this PDF.",
  currentPdf: "PDF for draft {version}",
  connectionFailed: "Could not connect to the server.",
  saving: "Saving…",
  saved: "Draft saved",
  unsaved: "Unsaved changes",
  conflict:
    "Another tab or device changed the draft. Copy your edits somewhere safe, then reload.",
  attachment: "This file is available to the compiler.",
  queued: "Waiting to compile",
  validating: "Checking input files",
  running: "Compiling",
  succeeded: "Compilation complete",
  failed: "Compilation failed",
  timeout: "Compilation timed out",
  rejected: "Compilation request was rejected",
  canceled: "Compilation canceled",
  expired: "This compile result has expired.",
  reconnect: "Reconnecting to check progress…",
  loadingErrors: "Loading compile errors…",
  errorsForDraft: "Errors in draft {version}",
  checkLog: "Check the compile log for details.",
  staleErrors: "These errors are from an older version of the draft.",
  waitForResult: "Waiting for the compile result.",
  fileName: "Name for the new text file",
  existingFile: "A file with that name already exists.",
  attachmentPath: "File path in the project",
  replaceFile: "Replace {path}?",
  newName: "New file name",
  confirmDelete: "Delete {path}?",
  revisionName: "Name for this revision",
  revisionSaved: "Revision saved",
  engineSaved:
    "Engine saved. The available document classes and fonts may change.",
  pdfUnavailable: "Could not open the PDF preview.",
  pngUnavailable: "Could not load the PNG preview.",
};

export type EditorMessages = typeof english;
export type EditorMessage = keyof EditorMessages;

export interface EditorCatalog {
  messages: EditorMessages;
  phrases: Record<string, string>;
}

export function formatEditorMessage(
  catalog: EditorCatalog,
  key: EditorMessage,
  args: Readonly<Record<string, string | number>> = {},
  numbers = new Intl.NumberFormat("en"),
): string {
  return catalog.messages[key].replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = args[name];
    return typeof value === "number" ? numbers.format(value) : (value ?? whole);
  });
}

export async function loadEditorCatalog(
  locale: string,
): Promise<EditorCatalog> {
  if (locale === "en") return { messages: english, phrases: {} };
  const name = encodeURIComponent(locale) + ".js";
  const resource =
    new URL(import.meta.url).pathname === "/app/assets/editor.js"
      ? "/app/assets/editor-locales/" + name
      : new URL("./locales/" + name, import.meta.url).href;
  const dictionary = (await import(resource)) as { default: EditorCatalog };
  return dictionary.default;
}
