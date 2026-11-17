import { isNewsletterBookmarkTarget } from '~/utils/bookmarkSource'

import type { DOMProcessor, WebProcessorContext } from './types'

// Keep the original DOM intact: saved annotations use direct-child selectors.
const FIT_CLASS = 'slax-table-fit'
// Article processors may replace native media with these visible player elements.
const MEDIA_SELECTOR = 'img, picture, video, audio, svg, canvas, iframe, object, embed, youtube-player-view, podcast-player-view, unsupported-video, wechat-video-info'

/** Share table fitting and empty-spacer handling between Article and Feed readers. */
export function observeTableLayout(container: HTMLElement, newsletter = false): (() => void) | undefined {
  const tables = Array.from(container.querySelectorAll<HTMLTableElement>('table'))
  const view = container.ownerDocument.defaultView
  if (!view || !tables.length) return

  if (newsletter) {
    for (const table of tables) {
      const rows = Array.from(table.rows)
      // Existing mail may have lost span attributes during intake. Do not guess
      // occupied columns in row-spanning layouts or replace explicit spans.
      if (rows.some(row => Array.from(row.cells).some(cell => cell.rowSpan !== 1))) continue
      const columns = Math.max(1, ...rows.map(row => Array.from(row.cells).reduce((sum, cell) => sum + cell.colSpan, 0)))
      for (const row of rows) {
        if (columns > 1 && row.cells.length === 1 && !row.cells[0]!.hasAttribute('colspan')) row.cells[0]!.colSpan = columns
      }
    }
  }

  const update = () => {
    for (const table of tables) {
      table.classList.toggle('slax-table-empty', !table.textContent?.trim() && !table.querySelector(MEDIA_SELECTOR))
      // Measure in the constrained scroll layout, then use native column sizing
      // only if all content fits. Wide tables retain their current scroll offset.
      table.classList.remove(FIT_CLASS)
      if (table.clientWidth > 0 && table.scrollWidth <= table.clientWidth) {
        table.classList.add(FIT_CLASS)
      }
    }
  }

  update()
  let frame = 0
  const observer = new view.ResizeObserver(() => {
    view.cancelAnimationFrame(frame)
    frame = view.requestAnimationFrame(update)
  })

  for (const table of tables) {
    if (table.parentElement) observer.observe(table.parentElement)
    observer.observe(table)
    // Row groups/captions can grow after fonts or images load even when the
    // outer scrollport keeps the same dimensions.
    for (const child of table.children) observer.observe(child)
  }
  return () => {
    observer.disconnect()
    view.cancelAnimationFrame(frame)
  }
}

export class TableLayoutProcessor implements DOMProcessor {
  readonly name = 'TableLayoutProcessor'

  match(): boolean {
    return true
  }

  process(context: WebProcessorContext): void {
    const cleanup = observeTableLayout(context.container, isNewsletterBookmarkTarget(context.url.href))
    if (cleanup) context.cleanups.push(cleanup)
  }
}
