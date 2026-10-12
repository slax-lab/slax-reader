import type { DOMProcessor, WebProcessorContext } from './types'

export class SpanProcessor implements DOMProcessor {
  readonly name = 'SpanProcessor'

  match(): boolean {
    return true
  }

  process(context: WebProcessorContext): void {
    const spans = Array.from(context.container.querySelectorAll('span')) as HTMLSpanElement[]

    spans.forEach(span => {
      if (span.textContent?.replace(/ /g, '').trim().length === 0 && !span.querySelector('img[src], video[src], picture:has(source[srcset]), svg, canvas, br')) {
        span.style.display = 'none'
      }
    })
  }
}
