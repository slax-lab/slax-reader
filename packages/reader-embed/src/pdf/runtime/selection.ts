import {validatePdfSources} from '@slax-reader/contracts/pdf'
import type {PdfMarkSource} from '@slax-reader/contracts/pdf'
import {capturePdfSelection} from '../../pdf-geometry.ts'
import type {PdfMarkItem, PdfSelection} from '../../pdf-types.ts'
import type {PageViewport, PdfRuntimeOptions, PdfRuntimePorts} from './types.ts'

interface PdfSelectionPorts {
  getViewport(number: number): PageViewport | undefined
  findMark(source: PdfMarkSource[]): PdfMarkItem | undefined
}
export function createPdfSelection(root: HTMLElement, options: PdfRuntimeOptions, ports: Pick<PdfRuntimePorts, 'lifecycle' | 'emit'> & PdfSelectionPorts) {
  const {lifecycle, emit} = ports
  let timer: ReturnType<typeof setTimeout> | undefined
  function capture(): PdfSelection | null {
    const selection = window.getSelection()
    if (!selection?.rangeCount || selection.isCollapsed) return null
    const source = capturePdfSelection(selection.getRangeAt(0), root, options.descriptor.document_id, ports.getViewport)
    if (!source.length || !validatePdfSources(source, options.descriptor.document_id)) return null
    const text = source.map(item => item.text).join('\n')
    return {source, text, select_content: [{type: 'text', text, src: ''}], approx_source: {exact: text, prefix: '', suffix: '', position_start: 0, position_end: text.length}}
  }
  function changed() {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (lifecycle.disposed || lifecycle.failed || !lifecycle.active) return
      try {
        const selection = capture()
        if (!selection) return emit({type: 'textDeselected'})
        const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect()
        const mark = ports.findMark(selection.source) ?? {id: '', source: selection.source, stroke: [], comments: [], approx: selection.approx_source}
        emit({type: 'textSelected', text: selection.text, mark, selection, selectionGeometry: {touchClientY: null, top: rect.top, bottom: rect.bottom}})
      } catch {emit({type: 'selectionError', error: 'Invalid PDF selection'})}
    }, 100)
  }
  function clear() {window.getSelection()?.removeAllRanges(); emit({type: 'textDeselected'})}
  function suspend() {clearTimeout(timer)}
  function dispose() {suspend(); document.removeEventListener('selectionchange', changed)}
  document.addEventListener('selectionchange', changed)
  return {capture, clear, suspend, dispose}
}
