import {
  getDocument,
  PDFDataRangeTransport,
  PDFWorker,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { createPdfPages } from "@slax-reader/reader-embed/pdf/runtime/pages";
import { createPdfMarks } from "@slax-reader/reader-embed/pdf/runtime/marks";
import { createPdfSelection } from "@slax-reader/reader-embed/pdf/runtime/selection";
import type {
  PdfRuntimeOptions,
  PdfRuntimePorts,
} from "@slax-reader/reader-embed/pdf/runtime/types";
const host = window as typeof window & {
  __SLAX_PDF_OPTIONS__: PdfRuntimeOptions;
  __SLAX_PDF_ASSETS__: { worker: string; resources: Record<string, string> };
};
const options = host.__SLAX_PDF_OPTIONS__,
  assets = host.__SLAX_PDF_ASSETS__;
const root = document.getElementById("pages")!,
  status = document.getElementById("status")!;
const lifecycle = {
  disposed: false,
  failed: false,
  active: true,
  generation: 0,
};
const pending = new Map<
  string,
  { begin: number; end: number; timer: ReturnType<typeof setTimeout> }
>();
const post = (value: object) => {
  if (!lifecycle.disposed)
    parent.postMessage(
      { channel: "slax-pdf", pageId: options.pageId, ...value },
      "*",
    );
};
let sequence = 0;
const queued: { begin: number; end: number }[] = [];
function send(begin: number, end: number) {
  const id = `range-${++sequence}`;
  pending.set(id, { begin, end, timer: setTimeout(error, 35000) });
  post({ kind: "range", id, begin, end });
}
function drain() {
  while (pending.size < 32 && queued.length) {
    const next = queued.shift()!;
    send(next.begin, next.end);
  }
}
function error() {
  if (lifecycle.disposed) return;
  lifecycle.failed = true;
  status.hidden = false;
  status.textContent = options.labels.error;
  status.setAttribute("role", "alert");
  post({ kind: "error", code: "PDF_RENDER_FAILED" });
}
const ports: PdfRuntimePorts = {
  lifecycle,
  post,
  emit: (event) => post({ kind: "event", event }),
  error,
};
const pages = createPdfPages(root, options, {
  ...ports,
  clearSelection: () => selection.clear(),
  drawMarks: (number) => marks.drawPage(number),
});
const marks = createPdfMarks(root, options, {
  emit: ports.emit,
  getPage: pages.getPage,
  pageNumbers: pages.pageNumbers,
});
const selection = createPdfSelection(root, options, {
  ...ports,
  getViewport: (number) => pages.getPage(number)?.viewport,
  findMark: marks.find,
});
class BinaryRange extends PDFDataRangeTransport {
  requestDataRange(begin: number, end: number) {
    if (
      lifecycle.disposed ||
      lifecycle.failed ||
      begin < 0 ||
      end <= begin ||
      end > options.descriptor.size
    )
      return error();
    if (pending.size >= 32) {
      if (queued.length >= 256) return error();
      queued.push({ begin, end });
      return;
    }
    send(begin, end);
  }
  abort() {
    for (const request of pending.values()) clearTimeout(request.timer);
    pending.clear();
    queued.length = 0;
  }
}
const range = new BinaryRange(
  options.descriptor.size,
  new Uint8Array(),
  true,
  options.descriptor.filename,
);
const decode = (text: string) =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
class LocalResources {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const directory: Record<string, string> = {
      cMapUrl: "cmaps",
      standardFontDataUrl: "standard_fonts",
      wasmUrl: "wasm",
    };
    const key = `${directory[kind]}/${filename}`;
    if (!directory[kind] || !Object.hasOwn(assets.resources, key))
      throw Error("PDF_RESOURCE_DENIED");
    return decode(assets.resources[key]!);
  }
}
const workerUrl = URL.createObjectURL(
  new Blob([assets.worker], { type: "text/javascript" }),
);
const worker = new Worker(workerUrl, { type: "module", name: "slax-pdf" });
worker.addEventListener("error", error);
const pdfWorker = new PDFWorker({
  port: worker,
} as unknown as ConstructorParameters<typeof PDFWorker>[0]);
const loading = getDocument({
  range,
  rangeChunkSize: 65536,
  disableAutoFetch: true,
  disableStream: true,
  worker: pdfWorker,
  useWorkerFetch: false,
  BinaryDataFactory: LocalResources,
  cMapUrl: "slax-pdf-resource:cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "slax-pdf-resource:standard_fonts/",
  wasmUrl: "slax-pdf-resource:wasm/",
  iccUrl: "slax-pdf-resource:iccs/",
  enableXfa: false,
  useSystemFonts: false,
  isImageDecoderSupported: false,
});
function receive(event: MessageEvent) {
  const m = event.data;
  if (
    event.source !== parent ||
    lifecycle.disposed ||
    !m ||
    m.channel !== "slax-pdf-host" ||
    m.pageId !== options.pageId
  )
    return;
  if (m.kind === "range") {
    const request = pending.get(m.id);
    if (
      !request ||
      !(m.data instanceof ArrayBuffer) ||
      m.data.byteLength !== request.end - request.begin
    )
      return;
    pending.delete(m.id);
    clearTimeout(request.timer);
    range.onDataRange(request.begin, new Uint8Array(m.data));
    drain();
    return;
  }
  if (m.kind === "rangeError" && pending.has(m.id)) return error();
  if (m.kind === "marks" && Array.isArray(m.marks)) {
    try {
      marks.replace(m.marks);
    } catch {
      error();
    }
    return;
  }
  if (m.kind === "clearSelection") selection.clear();
  if (
    m.kind === "anchor" &&
    typeof m.anchor === "string" &&
    m.anchor.length <= 256
  ) {
    const match = /^(?:pdf:|page[=-]?|#page=)?(\d+)$/.exec(m.anchor);
    if (match) void pages.layout.scrollPage(Number(match[1]));
  }
}
document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  post({ kind: "contextMenu" });
});
window.addEventListener("message", receive);
window.addEventListener(
  "pagehide",
  () => {
    lifecycle.disposed = true;
    range.abort();
    selection.dispose();
    pages.dispose();
    marks.dispose();
    void loading.destroy();
    pdfWorker.destroy();
    worker.terminate();
    URL.revokeObjectURL(workerUrl);
    window.removeEventListener("message", receive);
  },
  { once: true },
);
void loading.promise
  .then((pdf) =>
    pages.initialize(
      pdf,
      () => {
        status.hidden = true;
      },
      () => ports.emit({ type: "domReady" }),
    ),
  )
  .catch(error);
