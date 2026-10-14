import type { DOMProcessor, WebProcessorContext } from './types'

export class DetailsProcessor implements DOMProcessor {
  readonly name = 'DetailsProcessor'

  match(): boolean {
    return true
  }

  process(context: WebProcessorContext): void {
    const details = Array.from(context.container.querySelectorAll('details')) as HTMLDetailsElement[]

    details.forEach(detail => {
      const summary = detail.querySelector('summary')
      if (summary) {
        detail.open = true
      }
    })
  }
}
