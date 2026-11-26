import type { EditorMessage } from "./messages.js";

interface DraftSnapshot {
  version: number;
  files: readonly { path: string }[];
}

export function installDraftRecovery<Draft extends DraftSnapshot>(options: {
  review: HTMLButtonElement;
  saveCopy: HTMLButtonElement;
  dialog: HTMLDialogElement;
  apply: HTMLButtonElement;
  pathLabel: HTMLElement;
  status: HTMLElement;
  serverText: HTMLElement;
  localText: HTMLElement;
  buffer: () => { path: string; unsaved: string | undefined };
  readDraft: (signal: AbortSignal) => Promise<Draft | null>;
  readText: (path: string, version: number, signal: AbortSignal) => Promise<string>;
  writeText: (path: string, version: number, content: string) => Promise<Draft>;
  resolve: (draft: Draft, path: string) => Promise<void>;
  describe: (element: HTMLElement, key: EditorMessage) => void;
  showError: (error: unknown, element: HTMLElement) => void;
}): void {
  const { review, saveCopy, dialog, apply, status } = options;
  let reading: AbortController | undefined;
  let reviewed: { path: string; version: number; content: string } | undefined;
  let applying = false;

  saveCopy.addEventListener("click", () => {
    const { path, unsaved } = options.buffer();
    if (unsaved === undefined) return;
    const url = URL.createObjectURL(
      new Blob([unsaved], { type: "text/plain; charset=utf-8" }),
    );
    const download = document.createElement("a");
    download.href = url;
    download.download = path.split("/").at(-1) || "main.tex";
    download.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  });

  review.addEventListener("click", () => {
    const { path, unsaved } = options.buffer();
    options.pathLabel.textContent = path;
    options.serverText.textContent = options.localText.textContent = "";
    apply.disabled = true;
    const controller = new AbortController();
    reading = controller;
    const { signal } = controller;
    options.describe(status, "loading");
    dialog.showModal();
    void (async () => {
      const latest = await options.readDraft(signal);
      if (signal.aborted) return;
      if (!latest?.files.some((file) => file.path === path)) {
        options.describe(status, "conflictFileMissing");
        return;
      }
      if (unsaved === undefined) {
        dialog.close();
        await options.resolve(latest, path);
        return;
      }
      const server = await options.readText(path, latest.version, signal);
      if (signal.aborted) return;
      const [before, after] = changedLines(server, unsaved);
      options.serverText.textContent = before;
      options.localText.textContent = after;
      options.describe(status, "conflictReviewHint");
      reviewed = { path, version: latest.version, content: unsaved };
      apply.disabled = false;
    })().catch((error: unknown) => {
      if (!signal.aborted) options.showError(error, status);
    });
  });

  dialog.addEventListener("close", () => {
    reading?.abort();
    reviewed = undefined;
    options.serverText.textContent = options.localText.textContent = "";
  });
  for (const name of ["cancel", "submit"])
    dialog.addEventListener(name, (event) => {
      if (applying) event.preventDefault();
    });
  apply.addEventListener("click", () => {
    if (!reviewed || applying) return;
    const { path, version, content } = reviewed;
    applying = true;
    apply.disabled = true;
    void options.writeText(path, version, content).then(async (draft) => {
      dialog.close();
      await options.resolve(draft, path);
    }).catch((error: unknown) => {
      reviewed = undefined;
      options.showError(error, status);
    }).finally(() => {
      applying = false;
    });
  });
}

function changedLines(server: string, local: string): [string, string] {
  const before = server.split("\n");
  const after = local.split("\n");
  let first = 0;
  while (first < before.length && first < after.length && before[first] === after[first])
    first++;
  let serverEnd = before.length;
  let localEnd = after.length;
  while (serverEnd > first && localEnd > first && before[serverEnd - 1] === after[localEnd - 1]) {
    serverEnd--;
    localEnd--;
  }
  return [
    before.slice(Math.max(first - 1, 0), serverEnd + 1).join("\n"),
    after.slice(Math.max(first - 1, 0), localEnd + 1).join("\n"),
  ];
}
