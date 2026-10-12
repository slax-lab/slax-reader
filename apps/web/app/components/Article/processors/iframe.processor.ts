import type { DOMProcessor, WebProcessorContext } from './types'

export class IFrameProcessor implements DOMProcessor {
  readonly name = 'IFrameProcessor'

  match(): boolean {
    return true
  }

  process(context: WebProcessorContext): void {
    const iframes = Array.from(context.container.querySelectorAll('iframe')) as HTMLIFrameElement[]

    iframes.forEach(iframe => {
      if (iframe.width && Number(iframe.width) > 100) {
        iframe.width = '100%'
      }
    })
  }
}
