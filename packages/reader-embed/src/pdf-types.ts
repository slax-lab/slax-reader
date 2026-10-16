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
  currentUserId: number
  platform?: 'ios' | 'android'
  hostViewport?: boolean
  initialPosition?: number | null
  marks?: ReaderMarkDetail
  labels?: Partial<PdfLabels>
}

export const PDF_BRIDGE_CHUNK_BYTES = 128 * 1024
export const PDF_ORIGIN = 'https://pdf.reader.slax.invalid/'
