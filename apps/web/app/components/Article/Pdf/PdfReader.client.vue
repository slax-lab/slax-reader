<template>
  <section class="pdf-reader" :class="{ 'pdf-original-colors': !themePaper, 'pdf-pages-spaced': pageSpacing }" ref="root" :aria-label="t('pdf.reader')">
    <div v-show="!isH5 || !panelOpen" class="pdf-control-rail" :class="{ expanded: controlsOpen }" :style="{ right: !isH5 && panelOpen ? `${panelWidth}px` : undefined }">
      <button class="pdf-control-toggle" :aria-label="t('pdf.controls')" :title="t('pdf.controls')" :aria-expanded="controlsOpen" aria-controls="pdf-page-controls" @click="controlsOpen = !controlsOpen">
        <span class="pdf-current-page"><span>{{ currentPage }}</span><span class="pdf-page-total">/ {{ pages || '—' }}</span></span>
        <svg class="pdf-toggle-icon" :class="{ open: controlsOpen }" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      <div v-show="controlsOpen" id="pdf-page-controls" class="pdf-toolbar" role="toolbar" aria-orientation="vertical" :aria-label="t('pdf.controls')">
        <div class="pdf-page-navigation" role="group" :aria-label="t('pdf.page')">
          <button class="pdf-page-button" :disabled="!pages || currentPage <= 1" :aria-label="t('pdf.previous')" :title="t('pdf.previous')" @click="goTo(currentPage - 1)">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m12 5.5-4.5 4.5 4.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
          <label class="pdf-page-label"><span class="sr-only">{{ t('pdf.page') }}</span><input type="number" inputmode="numeric" :value="currentPage" min="1" :max="pages" :disabled="!pages" @change="goTo(Number(($event.target as HTMLInputElement).value))" /><span class="pdf-page-total">/ {{ pages || '—' }}</span></label>
          <button class="pdf-page-button" :disabled="!pages || currentPage >= pages" :aria-label="t('pdf.next')" :title="t('pdf.next')" @click="goTo(currentPage + 1)">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m8 5.5 4.5 4.5-4.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
        </div>
        <div class="pdf-control-divider" />
        <div class="pdf-zoom-controls">
          <button :disabled="!pages || scale <= 0.25" :aria-label="t('pdf.zoom_out')" :title="t('pdf.zoom_out')" @click="zoom(-0.25)">−</button>
          <output class="pdf-scale">{{ Math.round(scale * 100) }}%</output>
          <button :disabled="!pages || scale >= 3" :aria-label="t('pdf.zoom_in')" :title="t('pdf.zoom_in')" @click="zoom(0.25)">+</button>
        </div>
        <button :disabled="!pages" :title="t('pdf.fit')" @click="fitWidth">{{ t('pdf.fit') }}</button>
        <div class="pdf-control-divider" />
        <button :disabled="!pages" :aria-pressed="!themePaper" @click="themePaper = !themePaper">{{ t(themePaper ? 'pdf.original_colors' : 'pdf.theme_colors') }}</button>
        <button :disabled="!pages" :aria-pressed="pageSpacing" @click="pageSpacing = !pageSpacing">{{ t('pdf.page_spacing') }}</button>
      </div>
    </div>
    <p v-if="loading || error" class="pdf-status" role="status">{{ error || t('pdf.loading') }}<button v-if="error" @click="loadDocument">{{ t('pdf.retry') }}</button></p>
    <p v-if="pdf.text_status !== 'ready'" class="pdf-text-status" role="status">{{ t(`pdf.text_${pdf.text_status}`) }}</p>
    <div class="pdfViewer" ref="viewerElement" tabindex="0" :aria-label="t('pdf.reader')" @pointerup="queueSelection" @keyup="queueSelection" @click="onPdfClick" />
    <div v-if="draft" ref="selectionMenu" class="pdf-selection-actions" :style="selectionStyle" role="toolbar" :aria-label="t('pdf.selection_actions')" @pointerdown.prevent @keydown.esc="clearDraft">
      <PdfSelectionMenu :key="draft.id" :allow-action="allowAction" :is-stroked="hasOwnStroke" :saving="saving"
        :allow-chatbot="pdf.text_status === 'ready' && adapters.allowChatbot !== false"
        @action="selectionAction" @dismiss="clearDraft" @resize="positionSelectionMenu" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { MarkManager, type IMarkRenderer, type IMarkModal, type SelectionConfig } from '@slax-reader/selection'
import { MarkType } from '@slax-reader/contracts/interface'
import { validatePdfSources, pdfMetadataAuthor, type PdfDescriptor, type PdfMarkSource } from '@slax-reader/contracts/pdf'
import type { MarkDetail } from '@commons/frontend-types/models'
import type { MarkItemInfo, QuoteData } from '@slax-reader/selection/types'
import type { EventBus } from 'pdfjs-dist/types/web/pdf_viewer'
import type { PDFDocumentLoadingTask } from 'pdfjs-dist/types/src/display/api'
import { DwebBookmarkProvider, DwebEnvironmentAdapter, DwebHttpClient, DwebI18nService, DwebToastService, DwebUserProvider } from '../Selection/adapters'
import type { ArticleSelectionAdapters } from '../Selection/injection'
import type { ReaderSelection } from '../Selection/ReaderSelection'
import Toast, { ToastType } from '~/components/Toast'
import { capturePdfSelection, findPdfTextRange, quadToViewport } from './geometry'
import { InlinePdfViewer } from './InlinePdfViewer'
import { themedPdfPageView } from './ThemedPdfPageView'
import { placeSelectionMenu } from './selectionPosition'
import PdfSelectionMenu from './PdfSelectionMenu.client.vue'
import { MenuType } from '../Selection/type'
import { copyText } from '@commons/frontend-utils/string'
import CursorToast from '~/components/CursorToast'
import { useSnapshotLayout } from '~/composables/useSnapshotLayout'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/web/pdf_viewer.css'

const props = defineProps<{
  pdf: PdfDescriptor
  marks?: MarkDetail
  ready: boolean
  allowAction: boolean
  bookmarkId?: number
  bookmarkUid?: string
  shareCode?: string
  ownerUserId?: number | string
  collection?: { code: string; cb_id: number }
  adapters: ArticleSelectionAdapters
}>()
const emit = defineEmits<{ selection: [selection: ReaderSelection | null]; quote: [quote: QuoteData]; metadata: [metadata: { author?: string }] }>()
const { t } = useI18n()
const colorMode = useColorMode()
const themePaper = ref(true)
const pageSpacing = ref(false)
const root = ref<HTMLDivElement>()
const viewerElement = ref<HTMLDivElement>()
const selectionMenu = ref<HTMLDivElement>()
const selectionStyle = ref({ left: '0px', top: '0px', visibility: 'hidden' as 'hidden' | 'visible' })
const { isH5, panelOpen, panelWidth } = useSnapshotLayout()
const controlsOpen = ref(false)
const loading = ref(true)
const error = ref('')
const pages = ref(0)
const currentPage = ref(1)
const scale = ref(1)
const draft = shallowRef<MarkItemInfo | null>(null)
const saving = ref(false)
const userProvider = new DwebUserProvider()
const hasOwnStroke = computed(() => draft.value?.stroke.some(stroke => stroke.userId === userProvider.getUserId()) ?? false)
let viewer: InlinePdfViewer | undefined
let bus: EventBus | undefined
let loadingTask: PDFDocumentLoadingTask | undefined
let manager: MarkManager | undefined
let resizeObserver: ResizeObserver | undefined
let generation = 0
let redrawFrame = 0
let pendingReveal: string | undefined
let pendingQuote: { page: number; text: string } | undefined
let quoteFlash: PdfMarkSource | undefined
let quoteTimer: ReturnType<typeof setTimeout> | undefined
let fit = true
let selectionTimer: ReturnType<typeof setTimeout> | undefined
let selectionEvent: Event | undefined
let selectionAnchor: { range: Range; offsetX: number; offsetY: number } | undefined
let observedWidth = 0
let markClick: Parameters<IMarkRenderer['setMarkClickHandler']>[0]
const infos = new Map<string, MarkItemInfo>()
const pageInfos = new Map<number, Set<MarkItemInfo>>()

function clearDraft() { draft.value = null; selectionAnchor = undefined; window.getSelection()?.removeAllRanges() }
function goTo(page: number) {
  if (!viewer || !pages.value) return
  clearDraft()
  viewer.currentPageNumber = Math.max(1, Math.min(pages.value, Math.floor(page) || 1))
}
function fitWidth() { if (viewer && pages.value) { clearDraft(); fit = true; viewer.currentScaleValue = 'page-width' } }
function zoom(delta: number) {
  if (!viewer) return
  clearDraft(); fit = false
  viewer.currentScale = Math.min(3, Math.max(0.25, viewer.currentScale + delta))
}
function openComment(info: MarkItemInfo, compose = false) {
  clearDraft()
  const existing = manager?.markItemInfos.value.some(item => item.id === info.id)
  const quote: QuoteData = { source: { paths: info.source, ...(existing ? { id: info.id } : {}) }, data: info.source.flatMap(item => item.type === 'pdf' ? [{ type: 'text' as const, content: item.text }] : []) }
  window.dispatchEvent(new CustomEvent('slax:open-comment-panel', {
    detail: existing ? { kind: 'existing', infoId: info.id, info, compose } : { kind: 'new', info, quote }
  }))
}
function onPdfClick(event: MouseEvent) {
  if (!viewer || !window.getSelection()?.isCollapsed) return
  const target = event.target as Element
  if (!target.closest('.textLayer')) return
  const page = target.closest<HTMLElement>('.page')
  const number = Number(page?.dataset.pageNumber)
  const view = viewer.getPageView(number - 1)
  if (!page || !view) return
  const rect = page.getBoundingClientRect()
  const x = (event.clientX - rect.left - page.clientLeft) * view.viewport.width / page.clientWidth
  const y = (event.clientY - rect.top - page.clientTop) * view.viewport.height / page.clientHeight
  for (const info of pageInfos.get(number) ?? []) {
    if (!info.stroke.length && !info.comments.length) continue
    for (const source of info.source) if (source.type === 'pdf' && source.page === number && source.document_id === props.pdf.document_id) {
      if (source.quads.some(quad => {
        const points = quadToViewport(quad, view.viewport)
        return x >= Math.min(...points.map(p => p[0]!)) && x <= Math.max(...points.map(p => p[0]!)) && y >= Math.min(...points.map(p => p[1]!)) && y <= Math.max(...points.map(p => p[1]!))
      })) { openComment(info); return }
    }
  }
}

/** Redraw only pages whose upstream text layers are mounted. */
function drawPage(number: number) {
  if (!viewer) return
  const view = viewer.getPageView(number - 1)
  if (!view?.div.querySelector('.textLayer') || view.viewport.width <= 0 || view.viewport.height <= 0) return
  view.div.querySelector('.slax-pdf-marks')?.remove()
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.classList.add('slax-pdf-marks')
  svg.setAttribute('viewBox', `0 0 ${view.viewport.width} ${view.viewport.height}`)
  for (const info of pageInfos.get(number) ?? []) {
    if (!info.stroke.length && !info.comments.length) continue
    for (const source of info.source) {
      if (source.type !== 'pdf' || source.page !== number || source.document_id !== props.pdf.document_id) continue
      for (const quad of source.quads) {
        const points = quadToViewport(quad, view.viewport)
        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
        polygon.setAttribute('points', points.map(point => point.join(',')).join(' '))
        polygon.setAttribute('class', 'pdf-mark-fill')
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
        line.setAttribute('points', points.slice(2).map(point => point.join(',')).join(' '))
        line.setAttribute('class', info.comments.length ? 'pdf-mark-line has-comments' : 'pdf-mark-line')
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
        group.dataset.uuid = info.id
        group.setAttribute('role', 'button')
        group.setAttribute('tabindex', '0')
        group.setAttribute('aria-label', `${t('pdf.comment')}: ${source.text}`)
        group.appendChild(polygon); group.appendChild(line)
        if (info.comments.length && source === info.source.at(-1) && quad === source.quads.at(-1)) {
          const icon = document.createElementNS('http://www.w3.org/2000/svg', 'path')
          icon.setAttribute('d', 'M2.3333 3 H11 a.6667.6667 0 0 1 .6667.6667 V9.3333 A.6667.6667 0 0 1 11 10 H4.6667 L2.3333 11.6667 Z')
          icon.setAttribute('transform', `translate(${Math.max(...points.map(point => point[0]!)) + 4}, ${Math.max(...points.map(point => point[1]!)) - 12})`)
          icon.setAttribute('class', 'pdf-comment-indicator')
          group.appendChild(icon)
        }
        const hover = (active: boolean) => viewerElement.value?.querySelectorAll(`[data-uuid="${CSS.escape(info.id)}"]`).forEach(node => node.classList.toggle('pdf-mark-hover', active))
        group.addEventListener('mouseenter', () => hover(true))
        group.addEventListener('mouseleave', () => hover(false))
        group.addEventListener('click', event => { draft.value = info; markClick?.(group as unknown as HTMLElement, event as PointerEvent) })
        group.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); draft.value = info; openComment(info) }
        })
        svg.appendChild(group)
      }
    }
  }
  if (quoteFlash?.page === number) for (const quad of quoteFlash.quads) {
    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
    polygon.setAttribute('points', quadToViewport(quad, view.viewport).map(point => point.join(',')).join(' '))
    polygon.setAttribute('class', 'pdf-mark-fill pdf-quote-flash')
    svg.appendChild(polygon)
  }
  view.div.appendChild(svg)
}
function queueRedraw() {
  if (redrawFrame) return
  redrawFrame = requestAnimationFrame(() => { redrawFrame = 0; redrawRendered() })
}
function redrawRendered() {
  viewerElement.value?.querySelectorAll<HTMLElement>('.page').forEach(page => drawPage(Number(page.dataset.pageNumber)))
}
function revealMark(id: string) {
  const info = manager?.markItemInfos.value.find(item => item.id === id)
  const source = info?.source.find(item => item.type === 'pdf')
  if (!source || source.type !== 'pdf') return
  pendingReveal = id
  goTo(source.page)
  nextTick(() => {
    drawPage(source.page)
    const mark = viewer?.getPageView(source.page - 1)?.div.querySelector(`[data-uuid="${CSS.escape(id)}"]`) as SVGElement | null
    mark?.scrollIntoView({ block: 'center', inline: 'nearest' })
    if (mark) pendingReveal = undefined
    mark?.classList.add('pdf-mark-active')
    setTimeout(() => mark?.classList.remove('pdf-mark-active'), 3000)
  })
}
async function findQuote(quote: QuoteData) {
  if (quote.source.id) { revealMark(quote.source.id); return }
  const pageSource = quote.source.paths?.find(item => item.type === 'pdf')
  if (pageSource?.type === 'pdf') { revealQuote(pageSource.page, pageSource.text); return }
  const text = quote.data.filter(item => item.type === 'text').map(item => item.content).join(' ').replace(/\s+/g, '').trim()
  const document = viewer?.pdfDocument
  if (!document || !text) return
  const currentGeneration = generation
  for (let page = 1; page <= document.numPages; page++) {
    if (currentGeneration !== generation) return
    const pdfPage = await document.getPage(page)
    const content = await pdfPage.getTextContent()
    const pageText = content.items.map(item => 'str' in item ? item.str : '').join('').replace(/\s+/g, '')
    if (pageText.includes(text)) { revealQuote(page, text); return }
    pdfPage.cleanup()
  }
  Toast.showToast({ text: t('pdf.quote_not_found'), type: ToastType.Error })
}
function revealQuote(page: number, text: string) {
  pendingQuote = { page, text }
  goTo(page)
  nextTick(() => flashQuote(page))
}
function flashQuote(page: number) {
  if (pendingQuote?.page !== page || !viewer) return
  const view = viewer.getPageView(page - 1)
  const layer = view?.div.querySelector('.textLayer') as HTMLElement | null
  if (!view || !layer) return
  const range = findPdfTextRange(layer, pendingQuote.text)
  if (!range) return
  const captured = capturePdfSelection(range, view.div, props.pdf.document_id, () => view.viewport)[0]
  if (!captured) return
  quoteFlash = captured
  range.startContainer.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' })
  pendingQuote = undefined
  drawPage(page)
  clearTimeout(quoteTimer)
  quoteTimer = setTimeout(() => { quoteFlash = undefined; drawPage(page) }, 3000)
}
function setupMarks() {
  if (!root.value) return
  const renderer: IMarkRenderer = {
    async drawMark(info) {
      const previous = infos.get(info.id)
      if (previous) for (const source of previous.source) if (source.type === 'pdf') pageInfos.get(source.page)?.delete(previous)
      infos.set(info.id, info)
      for (const source of info.source) if (source.type === 'pdf') {
        if (!pageInfos.has(source.page)) pageInfos.set(source.page, new Set())
        pageInfos.get(source.page)!.add(info)
      }
      queueRedraw(); return info.id
    },
    clearAllMarks() { infos.clear(); pageInfos.clear(); viewerElement.value?.querySelectorAll('.slax-pdf-marks').forEach(node => node.remove()) },
    setMarkClickHandler(handler) { markClick = handler },
    transferNodeInfos() { return [] }
  }
  const modal: IMarkModal = {
    isPanelExist: () => false, showMenus: () => {},
    showPanel: ({ info }) => openComment(info), dismissPanel: async () => {}
  }
  const config: SelectionConfig = {
    containerDom: root.value, monitorDom: root.value, allowAction: props.allowAction,
    postQuoteDataHandler: quote => emit('quote', quote)
  }
  manager = new MarkManager(config, new DwebEnvironmentAdapter(), {
    userProvider, httpClient: props.adapters.httpClient?.() ?? new DwebHttpClient(),
    toastService: new DwebToastService(), i18nService: new DwebI18nService(),
    bookmarkProvider: new DwebBookmarkProvider({ bookmarkId: props.bookmarkId, bookmarkUid: props.bookmarkUid, shareCode: props.shareCode, collection: props.collection, ownerUserId: toValue(props.adapters.ownerUserId) ?? props.ownerUserId as number }),
    refFactory: ref, getMarkType: type => type === 'line' ? MarkType.LINE : type === 'reply' ? MarkType.REPLY : MarkType.COMMENT
  }, renderer, modal, quote => { void findQuote(quote) })
  emit('selection', {
    markItemInfos: manager.markItemInfos, strokeSelection: meta => savePdfMark(meta),
    deleteStroke: info => manager!.deleteStroke(info), deleteComment: (id, uid) => manager!.deleteComment(id, uid),
    findQuote: quote => { void findQuote(quote) }, revealMark
  })
  if (props.ready) void manager.drawMarks(props.marks ?? { mark_list: [], user_list: {} })
}
function captureSelection(event?: Event) {
  if (!viewer || !root.value) return
  const selection = window.getSelection()
  if (!selection?.rangeCount || selection.isCollapsed) { draft.value = null; selectionAnchor = undefined; return }
  const range = selection.getRangeAt(0)
  if (!root.value.contains(range.startContainer) || !root.value.contains(range.endContainer)) { draft.value = null; selectionAnchor = undefined; return }
  const source = capturePdfSelection(range.cloneRange(), root.value, props.pdf.document_id, page => viewer?.getPageView(page - 1)?.viewport)
  try { if (validatePdfSources(source, props.pdf.document_id) === undefined) return }
  catch { Toast.showToast({ text: t('pdf.selection_invalid'), type: ToastType.Error }); draft.value = null; return }
  const text = source.map(item => item.text).join('\n')
  const unchanged = draft.value && manager?.checkMarkSourceIsSame(draft.value.source, source)
  const existing = manager?.markItemInfos.value.find(info => manager?.checkMarkSourceIsSame(info.source, source))
  if (!unchanged) draft.value = existing ?? { id: crypto.randomUUID(), source, comments: [], stroke: [], approx: { exact: text, raw_text: text, prefix: '', suffix: '', position_start: 0, position_end: 0 } }
  if (!unchanged || event || !selectionAnchor) {
    const rect = range.getBoundingClientRect()
    const rects = Array.from(range.getClientRects()).filter(item => item.width > 0 && item.height > 0)
    const backwards = selection.focusNode === range.startContainer && selection.focusOffset === range.startOffset
    const endpoint = (backwards ? rects[0] : rects.at(-1)) ?? rect
    const mouse = event instanceof PointerEvent && event.pointerType === 'mouse'
    selectionAnchor = { range: range.cloneRange(), offsetX: (mouse ? event.clientX : backwards ? endpoint.left : endpoint.right) - rect.left, offsetY: (mouse ? event.clientY : endpoint.bottom) - rect.top }
  }
  void nextTick(positionSelectionMenu)
}
function queueSelection(event?: Event) {
  if (event) selectionEvent = event
  clearTimeout(selectionTimer)
  // Show the shared outside-click menu after the selecting click has completed.
  selectionTimer = setTimeout(() => { captureSelection(selectionEvent); selectionEvent = undefined }, 180)
}
function onSelectionChange() { queueSelection() }
function positionSelectionMenu() {
  if (!selectionAnchor || !selectionMenu.value) return
  const rect = selectionAnchor.range.getBoundingClientRect()
  const viewport = window.visualViewport
  const left = (viewport?.offsetLeft ?? 0) + 12
  const top = Math.max((viewport?.offsetTop ?? 0) + 12, isH5.value ? 60 : 64)
  const right = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth) - 12
  const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - 84
  if (rect.bottom < top || rect.top > bottom || rect.right < left || rect.left > right) {
    selectionStyle.value.visibility = 'hidden'; return
  }
  const menu = selectionMenu.value.getBoundingClientRect()
  const position = placeSelectionMenu({ x: rect.left + selectionAnchor.offsetX, y: rect.top + selectionAnchor.offsetY }, menu, { left, top, width: right - left, height: bottom - top })
  selectionStyle.value = { left: `${position.x}px`, top: `${position.y}px`, visibility: 'visible' }
}
function readPageColors() {
  // Original PDF colors remain available for color-dependent figures.
  if (!themePaper.value) return { background: '#ffffff', foreground: '#000000' }
  const style = getComputedStyle(root.value!)
  return { background: style.getPropertyValue('--slax-bg').trim(), foreground: style.getPropertyValue('--slax-text').trim() }
}
async function savePdfMark(meta: Parameters<MarkManager['strokeSelection']>[0]) {
  manager!.clearSelectContent()
  for (const source of meta.info.source) if (source.type === 'pdf') manager!.pushSelectContent({ type: 'text', text: source.text, src: '' })
  return manager!.strokeSelection(meta)
}
async function highlight() {
  if (!draft.value || !manager || saving.value) return
  saving.value = true
  try {
    if (hasOwnStroke.value) await manager.deleteStroke(draft.value)
    else await savePdfMark({ info: draft.value })
    clearDraft()
  } finally { saving.value = false }
}
function comment() { if (draft.value) { openComment(draft.value, true); clearDraft() } }
function askAi() {
  if (!draft.value) return
  emit('quote', { source: { paths: draft.value.source }, data: manager!.createQuote(draft.value.source, draft.value.approx) })
  clearDraft()
}
async function selectionAction(type: MenuType, event: MouseEvent) {
  if (!draft.value || saving.value) return
  if (type === MenuType.Copy) {
    try {
      await copyText(draft.value.source.flatMap(source => source.type === 'pdf' ? [source.text] : []).join('\n'))
      CursorToast.showToast({ text: t('common.tips.copy_content_success'), trackDom: event.target as HTMLElement })
      clearDraft()
    } catch {
      Toast.showToast({ text: t('common.tips.operate_failed'), type: ToastType.Error })
    }
  } else if (props.allowAction && (type === MenuType.Stroke || type === MenuType.Stroke_Delete)) await highlight()
  else if (props.allowAction && type === MenuType.Comment) comment()
  else if (type === MenuType.Chatbot) askAi()
}
async function loadDocument() {
  const currentGeneration = ++generation
  loading.value = true; error.value = ''; pages.value = 0; clearDraft()
  await loadingTask?.destroy().catch(() => {})
  viewer?.destroy()
  try {
    const api = await import('pdfjs-dist/legacy/build/pdf.mjs')
    api.GlobalWorkerOptions.workerSrc = workerUrl
    const components = await import('pdfjs-dist/web/pdf_viewer.mjs')
    if (currentGeneration !== generation || !viewerElement.value) return
    bus = new components.EventBus()
    viewer = new InlinePdfViewer({ element: viewerElement.value, eventBus: bus, PageView: themedPdfPageView(components.PDFPageView, () => themePaper.value), maxCanvasPixels: isH5.value ? 2_000_000 : 4_000_000, pageColors: readPageColors() })
    bus.on('pagesinit', () => { fitWidth(); loading.value = false; redrawRendered() })
    bus.on('pagechanging', (event: { pageNumber: number }) => { currentPage.value = event.pageNumber })
    bus.on('scalechanging', (event: { scale: number }) => { scale.value = event.scale; redrawRendered() })
    bus.on('pageerror', () => { error.value = t('pdf.load_failed') })
    bus.on('textlayerrendered', (event: { pageNumber: number }) => {
      drawPage(event.pageNumber)
      flashQuote(event.pageNumber)
      if (pendingReveal) {
        const source = infos.get(pendingReveal)?.source.find(item => item.type === 'pdf')
        if (source?.type === 'pdf' && source.page === event.pageNumber) { const id = pendingReveal; pendingReveal = undefined; revealMark(id) }
      }
    })
    loadingTask = api.getDocument({ url: props.pdf.url, cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/', disableAutoFetch: true, disableStream: true, enableXfa: false })
    const document = await loadingTask.promise
    if (currentGeneration !== generation) { await document.loadingTask.destroy(); return }
    pages.value = document.numPages
    await viewer.setDocument(document)
    void document.getMetadata().then(metadata => {
      if (currentGeneration !== generation) return
      emit('metadata', { author: pdfMetadataAuthor(metadata.metadata?.get('dc:creator'), (metadata.info as { Author?: unknown })?.Author) })
    }).catch(() => {})
  } catch (failure) {
    if (currentGeneration !== generation) return
    console.warn('PDF reader initialization failed:', (failure as Error)?.message)
    error.value = t((failure as Error)?.name === 'PasswordException' ? 'pdf.password' : 'pdf.load_failed')
    loading.value = false
  }
}
watch(() => [props.marks, props.ready] as const, () => { if (props.ready && manager) void manager.drawMarks(props.marks ?? { mark_list: [], user_list: {} }) }, { deep: true })
watch(() => [colorMode.value, themePaper.value], async () => { clearDraft(); await nextTick(); if (viewer && root.value) viewer.setPageColors(readPageColors()) })
onMounted(() => {
  setupMarks(); void loadDocument()
  document.addEventListener('selectionchange', onSelectionChange)
  window.addEventListener('scroll', positionSelectionMenu, { passive: true, capture: true })
  window.addEventListener('resize', positionSelectionMenu)
  window.visualViewport?.addEventListener('resize', positionSelectionMenu)
  window.visualViewport?.addEventListener('scroll', positionSelectionMenu)
  resizeObserver = new ResizeObserver(entries => {
    const width = entries[0]?.contentRect.width ?? 0
    if (Math.abs(width - observedWidth) > 1) { observedWidth = width; if (fit) fitWidth() }
    positionSelectionMenu()
  })
  if (viewerElement.value) resizeObserver.observe(viewerElement.value)
})
onBeforeUnmount(() => {
  generation++; cancelAnimationFrame(redrawFrame); clearTimeout(selectionTimer); clearTimeout(quoteTimer); resizeObserver?.disconnect()
  document.removeEventListener('selectionchange', onSelectionChange)
  window.removeEventListener('scroll', positionSelectionMenu, true)
  window.removeEventListener('resize', positionSelectionMenu)
  window.visualViewport?.removeEventListener('resize', positionSelectionMenu)
  window.visualViewport?.removeEventListener('scroll', positionSelectionMenu)
  viewer?.destroy(); void loadingTask?.destroy().catch(() => {})
  infos.clear(); emit('selection', null)
})
defineExpose({ findQuote, revealMark })
</script>

<style scoped lang="scss">
.pdf-reader { position: relative; width: 100%; min-width: 0; margin-top: 8px; color: var(--slax-text); }
.pdf-control-rail {
  position: fixed;
  right: env(safe-area-inset-right, 0px);
  top: calc(var(--slax-header-h-snapshot) + 20px);
  z-index: 45;
  width: 44px;
  color: var(--slax-text-muted);
  font-family: var(--slax-font-sans);
}
.pdf-control-toggle {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 44px;
  min-height: 76px;
  padding: 10px 2px;
  border: 1px solid var(--slax-border);
  border-right: 0;
  border-radius: var(--slax-radius-sm) 0 0 var(--slax-radius-sm);
  background: var(--slax-surface);
  color: var(--slax-text-muted);
  cursor: pointer;
}
.pdf-control-toggle:hover, .pdf-control-toggle[aria-expanded='true'] {
  color: var(--slax-accent);
  background: var(--slax-surface-solid);
}
.pdf-toggle-icon { flex: none; }
.pdf-toggle-icon.open { transform: rotate(90deg); }
.pdf-current-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  font-size: var(--slax-fs-meta);
  font-weight: 500;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.pdf-page-total { color: var(--slax-text-muted); font-size: var(--slax-fs-aux); font-weight: 400; font-variant-numeric: tabular-nums; }
.pdf-toolbar {
  position: absolute;
  top: 0;
  right: 52px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-sizing: border-box;
  width: 224px;
  max-height: calc(100dvh - var(--slax-header-h-snapshot) - 112px);
  padding: 8px;
  overflow-x: hidden;
  overflow-y: auto;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  background: var(--slax-surface-solid);
  box-shadow: var(--slax-shadow-sm);
}
.pdf-page-navigation { display: grid; grid-template-columns: 36px minmax(0, 1fr) 36px; align-items: center; gap: 4px; }
.pdf-page-button { display: flex; align-items: center; justify-content: center; }
.pdf-control-divider { height: 1px; background: var(--slax-border); margin: 4px 2px; }
.pdf-toolbar button, .pdf-status button {
  min-height: 36px;
  min-width: 36px;
  padding: 6px 10px;
  border: 0;
  border-radius: var(--slax-radius-sm);
  background: transparent;
  color: var(--slax-text-muted);
  font: inherit;
  font-size: var(--slax-fs-aux);
  line-height: 1.4;
  cursor: pointer;
}
.pdf-toolbar .pdf-page-button { padding: 0; }
button:hover:not(:disabled) { color: var(--slax-accent); background: var(--slax-accent-bg); }
button:active:not(:disabled) { color: var(--slax-accent); background: var(--slax-accent-soft); }
button:disabled { opacity: .4; cursor: default; }
button:focus-visible, input:focus-visible, .pdfViewer:focus-visible { outline: 2px solid var(--slax-accent); outline-offset: -2px; }
.pdf-page-label { display: flex; align-items: center; justify-content: center; gap: 6px; min-width: 0; font-size: var(--slax-fs-aux); white-space: nowrap; }
.pdf-page-label input {
  box-sizing: border-box;
  width: 44px;
  min-width: 0;
  min-height: 36px;
  padding: 4px;
  border: 1px solid var(--slax-border);
  border-radius: 6px;
  background: var(--slax-bg);
  color: var(--slax-text);
  text-align: center;
  font: inherit;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  appearance: textfield;
}
.pdf-page-label input::-webkit-inner-spin-button, .pdf-page-label input::-webkit-outer-spin-button { margin: 0; appearance: none; }
.pdf-page-label input:disabled { opacity: .4; }
.pdf-zoom-controls { display: grid; grid-template-columns: 36px minmax(0, 1fr) 36px; align-items: center; gap: 4px; }
.pdf-scale { font-size: var(--slax-fs-aux); text-align: center; font-variant-numeric: tabular-nums; }
.pdf-status, .pdf-text-status { padding: 12px; font-size: var(--slax-fs-aux); color: var(--slax-text-muted); }
.pdfViewer { padding: 0; }
:deep(.pdf-page-slot) { width: 100%; overflow-x: auto; overflow-y: hidden; margin-bottom: 0; scroll-margin-top: calc(var(--slax-header-h-snapshot) + 16px); }
.pdf-pages-spaced :deep(.pdf-page-slot) { margin-bottom: 20px; }
.pdf-toolbar button[aria-pressed='true'] { color: var(--slax-accent); background: var(--slax-accent-bg); }
:deep(.pdfViewer .page) { margin: 0 auto; border: 0; box-shadow: none; flex-shrink: 0; background: transparent; }
.pdf-original-colors :deep(.pdfViewer .page) { background: var(--page-bg-color); }
.pdf-selection-actions { position: fixed; z-index: 46; max-width: calc(100vw - 24px); }
:deep(.slax-pdf-marks) { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 4; pointer-events: none; overflow: visible; }
:deep(.pdf-mark-fill) { fill: transparent; pointer-events: none; }
:deep(.pdf-mark-line) { fill: none; stroke: color-mix(in srgb, var(--slax-accent) 50%, transparent); stroke-width: 1.5; stroke-dasharray: 3 2; vector-effect: non-scaling-stroke; pointer-events: stroke; cursor: pointer; }
:deep(.pdf-mark-line.has-comments) { stroke-dasharray: none; }
:deep(.pdf-comment-indicator) { fill: none; stroke: var(--slax-accent); stroke-width: 1.15; pointer-events: bounding-box; cursor: pointer; }
:deep(.pdf-mark-hover .pdf-mark-fill) { fill: var(--slax-accent-bg); }
:deep(.pdf-mark-hover .pdf-mark-line) { stroke: var(--slax-accent); }
:deep(.pdf-mark-active .pdf-mark-fill), :deep(g:focus .pdf-mark-fill), :deep(.pdf-quote-flash) { fill: var(--slax-quote-highlight); }
:deep(.pdfViewer .page) { color-scheme: light; }
@media (max-width: 768px) {
  .pdf-control-rail { top: calc(var(--slax-header-h-mobile) + 12px); }
  .pdf-toolbar { width: 236px; max-width: calc(100vw - 68px - env(safe-area-inset-right, 0px)); max-height: calc(100dvh - var(--slax-header-h-mobile) - 100px); }
  .pdf-toolbar button, .pdf-page-label input { min-height: 44px; min-width: 44px; }
  .pdf-page-navigation, .pdf-zoom-controls { grid-template-columns: 44px minmax(0, 1fr) 44px; }
  .pdf-selection-actions { width: max-content; }
  :deep(.pdf-page-slot) { scroll-margin-top: calc(var(--slax-header-h-mobile) + 16px); }
}
@media (prefers-reduced-motion: reduce) { .pdf-reader * { scroll-behavior: auto; } }
</style>
