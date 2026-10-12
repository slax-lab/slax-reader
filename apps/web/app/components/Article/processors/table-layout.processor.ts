import type { DOMProcessor, WebProcessorContext } from './types'

// Keep the original DOM intact: saved annotations use direct-child selectors.
const FIT_CLASS = 'slax-table-fit'

export class TableLayoutProcessor implements DOMProcessor {
  readonly name = 'TableLayoutProcessor'

  match(): boolean {
    return true
  }

  process(context: WebProcessorContext): void {
    const tables = Array.from(context.container.querySelectorAll<HTMLTableElement>('table'))
    const view = context.container.ownerDocument.defaultView
    if (!view || !tables.length) return

    const update = () => {
      for (const table of tables) {
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

    context.cleanups.push(() => {
      observer.disconnect()
      view.cancelAnimationFrame(frame)
    })
  }
}
