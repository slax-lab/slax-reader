import type {PdfDescriptor, PdfMarkSource} from '@slax-reader/contracts/pdf'
import type {MarkPathApprox} from '@slax-reader/contracts/interface'
import type {ReaderEvent, ReaderMarkDetail, ReaderMarkItem} from './types.ts'

export interface PdfSelection {
  source: PdfMarkSource[]
  select_content: Array<{type: 'text'; text: string; src: string}>
  approx_source: MarkPathApprox
  text: string
}

export type PdfMarkItem = Omit<ReaderMarkItem, 'source'> & {source: PdfMarkSource[]}
export type PdfReaderEvent = Exclude<ReaderEvent, {type: 'textSelected' | 'markClicked' | 'markItemInfosChanged'}>
  | {type: 'textSelected'; text: string; mark: PdfMarkItem; selection: PdfSelection; selectionGeometry: {touchClientY: number | null; top: number | null; bottom: number | null}; containerYPoints?: number}
  | {type: 'markClicked'; markId: string; text: string; mark: PdfMarkItem | null}
  | {type: 'markItemInfosChanged'; marks: PdfMarkItem[]}

export interface PdfLabels {
  page: string
  loading: string
  error: string
  mark: string
}

export interface PdfDocumentOptions {
  pageId: string
  descriptor: Pick<PdfDescriptor, 'size' | 'document_id' | 'filename'>
  /** `pdfSourcePath` of the document; the page fetches its byte ranges from this path on its own origin. */
  source: string
  currentUserId: number
  platform?: 'ios' | 'android'
  hostViewport?: boolean
  initialPosition?: number | null
  marks?: ReaderMarkDetail
  labels?: Partial<PdfLabels>
}

/** PDF.js range granularity. Ranges are fetched by the page itself from its own origin and served natively. */
export const PDF_RANGE_CHUNK_BYTES = 256 * 1024
/** Largest single native range response; wider PDF.js requests are split into parallel windows. */
export const PDF_RANGE_WINDOW_BYTES = 1024 * 1024
/** Android intercepts same-origin HTTPS subresources of this document origin. */
export const PDF_ORIGIN = 'https://pdf.reader.slax.invalid/'
/** WKWebView serves PDF bytes through a URL scheme handler; the page lives on that scheme so its fetches are same-origin. */
export const PDF_IOS_ORIGIN = 'slaxpdf://pdf/'
export const pdfOrigin = (platform?: 'ios' | 'android') => platform === 'ios' ? PDF_IOS_ORIGIN : PDF_ORIGIN
export const pdfCsp = (nonce: string, platform?: 'ios' | 'android') =>
  `default-src 'none'; script-src 'nonce-${nonce}' blob: 'wasm-unsafe-eval'; worker-src blob:; connect-src blob: ${pdfOrigin(platform).slice(0, -1)}; img-src blob: data:; font-src blob: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'`
/** Opaque byte source of one document: `/pdf/<bookmark key>/<document id>/<size>` on the page origin. */
export function pdfSourcePath(key: string, descriptor: Pick<PdfDescriptor, 'size' | 'document_id'>): string {
  if (!/^[A-Za-z0-9_-]{1,240}$/.test(key) || !/^[A-Za-z0-9_-]{1,256}$/.test(descriptor.document_id) || !Number.isSafeInteger(descriptor.size) || descriptor.size <= 0) throw new Error('Invalid PDF source')
  return `/pdf/${key}/${descriptor.document_id}/${descriptor.size}`
}
