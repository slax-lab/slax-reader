import type { DOMProcessor, WebProcessorContext } from './types'

export class AnchorProcessor implements DOMProcessor {
  readonly name = 'AnchorProcessor'

  match(): boolean {
    return true
  }

  process(context: WebProcessorContext): void {
    const anchors = Array.from(context.container.querySelectorAll('a')) as HTMLAnchorElement[]

    anchors.forEach(anchor => {
      const href = anchor.getAttribute('href')
      if (!href) return

      if (href.indexOf('#') === 0) {
        anchor.target = ''
      } else {
        const regex = /^\/.*/
        if (regex.test(href)) {
          anchor.href = `${context.url.origin}${href}`
        } else if (href.indexOf('http') === -1 && href.indexOf('https') === -1) {
          anchor.href = `${context.url.origin}${anchor.pathname}`
        }

        anchor.target = '_blank'
      }
    })
  }
}
