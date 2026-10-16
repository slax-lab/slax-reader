import type {PDFPageProxy, RenderTask} from 'pdfjs-dist/types/src/display/api'
import type {TextLayer} from 'pdfjs-dist/legacy/build/pdf.mjs'
import type {PdfDocumentOptions, PdfLabels, PdfReaderEvent} from '../../pdf-types.ts'
import type {PdfFailureStage} from '../../pdf-errors.ts'

export type PdfRuntimeOptions = PdfDocumentOptions & {labels: PdfLabels}
export type PdfRuntimeAssets = {worker: string; resources: Record<string, string>}
export type PdfRuntimeMessage = {channel: string; pageId: string; kind: string; id?: string; offset?: number; data?: string; operation?: string; argument?: unknown; error?: string; active?: boolean; height?: number; failure?: unknown}
export interface PdfRuntimeLifecycle {
  readonly disposed: boolean
  readonly failed: boolean
  readonly active: boolean
  readonly generation: number
}
export interface PdfRuntimePorts {
  lifecycle: PdfRuntimeLifecycle
  post(message: object): void
  emit(event: PdfReaderEvent): void
  error(reason: unknown, stage?: PdfFailureStage): void
}
export type PageViewport = ReturnType<PDFPageProxy['getViewport']>
export interface PdfResidentPage {
  page?: PDFPageProxy
  canvas: HTMLCanvasElement
  layer: HTMLElement
  overlay: SVGSVGElement
  viewport?: PageViewport
  render?: RenderTask
  text?: TextLayer
  epoch: number
}
export const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
