import type { DOMProcessor, WebProcessorContext } from './types'

export class ListProcessor implements DOMProcessor {
  readonly name = 'ListProcessor'

  match(): boolean {
    return true
  }

  process(context: WebProcessorContext): void {
    const uls = Array.from(context.container.querySelectorAll('ul')) as HTMLUListElement[]

    uls.forEach(ul => {
      if (ul.querySelector('li')) {
        ul.classList.add('has-li')
      }
    })
  }
}
