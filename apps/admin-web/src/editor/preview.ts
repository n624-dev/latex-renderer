import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist";

const assets = new URL("./pdf/", import.meta.url).href;
type Controls = {
  previous: HTMLButtonElement;
  next: HTMLButtonElement;
  download: HTMLAnchorElement;
  error: HTMLElement;
};
type PngSource = {
  pdf: string;
  pageCount: number;
  path: (page: number) => string;
};

/** Paint one page at a time and keep the last complete preview on a failed build. */
export class EditorPreview {
  private document?: PDFDocumentProxy;
  private displayed?: PDFDocumentLoadingTask;
  private loading?: () => Promise<void>;
  private painting?: RenderTask;
  private png?: PngSource;
  private page = 1;
  private generation = 0;
  private pendingDisplay?: number;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly controls: Controls,
    private readonly message: (
      key: "pngUnavailable" | "pdfUnavailable",
    ) => string,
  ) {
    controls.previous.addEventListener("click", () => void this.navigate(-1));
    controls.next.addEventListener("click", () => void this.navigate(1));
  }

  async show(url: string, signal: AbortSignal): Promise<boolean> {
    const generation = this.startDisplay();
    const current = () => !signal.aborted && generation === this.generation;
    const resource = assets + "pdf.mjs";
    let pdf: typeof import("pdfjs-dist");
    try {
      pdf = (await import(resource)) as typeof import("pdfjs-dist");
    } catch (error) {
      if (current()) this.report(error);
      this.finishDisplay(generation);
      return false;
    }
    if (!current()) {
      this.finishDisplay(generation);
      return false;
    }
    pdf.GlobalWorkerOptions.workerSrc = assets + "pdf.worker.mjs";
    const task = pdf.getDocument({
      url,
      cMapUrl: assets + "cmaps/",
      cMapPacked: true,
      standardFontDataUrl: assets + "standard_fonts/",
      iccUrl: assets + "iccs/",
      wasmUrl: assets + "wasm/",
      useWasm: false,
      disableAutoFetch: true,
      disableStream: true,
      canvasMaxAreaInBytes: 16 * 1024 * 1024,
    });
    let disposal: Promise<void> | undefined;
    const dispose = () => (disposal ??= task.destroy().catch(() => {}));
    const abort = () => void dispose();
    this.loading = dispose;
    this.updateButtons();
    signal.addEventListener("abort", abort, { once: true });
    let accepted = false;
    try {
      const document = await task.promise;
      const page = Math.min(this.page, document.numPages);
      if (!(await this.paint(document, page, generation)) || !current())
        return false;
      const previous = this.displayed;
      delete this.png;
      this.document = document;
      this.displayed = task;
      this.page = page;
      this.controls.download.href = url;
      this.controls.download.hidden = false;
      this.controls.error.hidden = true;
      accepted = true;
      this.updateButtons();
      await previous?.destroy().catch(() => {});
      return true;
    } catch (error) {
      if (current()) this.report(error);
      return false;
    } finally {
      signal.removeEventListener("abort", abort);
      if (this.loading === dispose) delete this.loading;
      if (!accepted) await dispose();
      this.finishDisplay(generation);
    }
  }

  async showPng(source: PngSource, signal: AbortSignal): Promise<boolean> {
    const generation = this.startDisplay();
    const page = Math.min(this.page, source.pageCount);
    try {
      if (
        !(await this.paintPng(source, page, signal, generation)) ||
        generation !== this.generation
      )
        return false;
      const previous = this.displayed;
      delete this.document;
      delete this.displayed;
      this.png = source;
      this.controls.download.href = source.pdf;
      this.controls.download.hidden = false;
      await previous?.destroy().catch(() => {});
      return true;
    } finally {
      this.finishDisplay(generation);
    }
  }

  async assetsMissing(signal: AbortSignal): Promise<boolean> {
    const responses = await Promise.allSettled(
      ["pdf.mjs", "pdf.worker.mjs"].map((file) =>
        fetch(assets + file, { method: "HEAD", cache: "no-store", signal }),
      ),
    );
    return responses.some(
      (result) => result.status === "fulfilled" && result.value.status === 404,
    );
  }

  private async navigate(step: number) {
    if (this.pendingDisplay !== undefined) return;
    const doc = this.document;
    const page = this.page + step;
    if (this.png) {
      if (page > 0 && page <= this.png.pageCount)
        await this.paintPng(this.png, page, AbortSignal.timeout(12000));
      return;
    }
    if (!doc || page < 1 || page > doc.numPages) return;
    const generation = ++this.generation;
    try {
      if (await this.paint(doc, page, generation)) {
        this.page = page;
        this.controls.error.hidden = true;
        this.updateButtons();
      }
    } catch (error) {
      if (generation === this.generation) this.report(error);
    }
  }

  private async paintPng(
    source: PngSource,
    page: number,
    signal: AbortSignal,
    generation = ++this.generation,
  ): Promise<boolean> {
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await fetch(source.path(page), {
          signal,
          redirect: "error",
        });
        if (response.status === 503 && attempt < 2) {
          await response.body?.cancel();
          await new Promise((resolve) => setTimeout(resolve, 2000));
          if (signal.aborted || generation !== this.generation) return false;
          continue;
        }
        if (
          !response.ok ||
          response.headers.get("content-type") !== "image/png"
        )
          throw new Error(this.message("pngUnavailable"));
        const image = await createImageBitmap(await response.blob());
        try {
          if (generation !== this.generation || signal.aborted) return false;
          const scale = Math.min(1, 2048 / Math.max(image.width, image.height));
          this.canvas.width = Math.ceil(image.width * scale);
          this.canvas.height = Math.ceil(image.height * scale);
          this.canvas
            .getContext("2d")
            ?.drawImage(image, 0, 0, this.canvas.width, this.canvas.height);
          this.canvas.hidden = false;
          this.canvas.setAttribute(
            "aria-label",
            `PNG ${page} / ${source.pageCount}`,
          );
          this.controls.error.hidden = true;
          this.page = page;
          this.updateButtons();
          return true;
        } finally {
          image.close();
        }
      }
    } catch (error) {
      if (generation === this.generation) this.report(error);
    }
    return false;
  }

  private async paint(
    doc: PDFDocumentProxy,
    number: number,
    generation: number,
  ) {
    const page = await doc.getPage(number);
    if (generation !== this.generation) return false;
    const size = page.getViewport({ scale: 1 });
    const available = this.canvas.parentElement?.clientWidth || size.width;
    const scale = Math.min(
      (available * Math.min(devicePixelRatio || 1, 2)) / size.width,
      2048 / Math.max(size.width, size.height),
    );
    const viewport = page.getViewport({ scale });
    const candidate = document.createElement("canvas");
    candidate.width = Math.ceil(viewport.width);
    candidate.height = Math.ceil(viewport.height);
    this.painting?.cancel();
    const task = page.render({ canvas: candidate, viewport });
    this.painting = task;
    try {
      await task.promise;
      if (generation !== this.generation) return false;
      this.canvas.width = candidate.width;
      this.canvas.height = candidate.height;
      this.canvas.getContext("2d")?.drawImage(candidate, 0, 0);
      this.canvas.hidden = false;
      this.canvas.setAttribute("aria-label", `PDF ${number} / ${doc.numPages}`);
      return true;
    } finally {
      if (this.painting === task) delete this.painting;
      candidate.width = candidate.height = 0;
      page.cleanup();
    }
  }

  private updateButtons() {
    const count = this.document?.numPages ?? this.png?.pageCount ?? 0;
    this.controls.previous.disabled =
      this.pendingDisplay !== undefined || this.page < 2;
    this.controls.next.disabled =
      this.pendingDisplay !== undefined || this.page >= count;
  }

  private report(error: unknown) {
    this.controls.error.textContent =
      error instanceof Error ? error.message : this.message("pdfUnavailable");
    this.controls.error.hidden = false;
  }

  private startDisplay() {
    const loading = this.loading;
    delete this.loading;
    void loading?.();
    this.painting?.cancel();
    this.pendingDisplay = ++this.generation;
    this.updateButtons();
    return this.generation;
  }

  private finishDisplay(generation: number) {
    if (this.pendingDisplay === generation) delete this.pendingDisplay;
    this.updateButtons();
  }

  async destroy() {
    ++this.generation;
    this.painting?.cancel();
    await this.loading?.();
    await this.displayed?.destroy().catch(() => {});
  }
}
