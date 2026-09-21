import type { DOMProcessor, WebProcessorContext } from './types'

export class WechatHeaderProcessor implements DOMProcessor {
  readonly name = 'WechatHeaderProcessor'

  match(context: WebProcessorContext): boolean {
    return context.url.host.includes('mp.weixin.qq.com')
  }

  process(context: WebProcessorContext): void {
    const isFirstElementChain = (el: Element): boolean => {
      let current: Element | null = el
      while (current) {
        const parent: Element | null = current.parentElement
        if (!parent) return false

        const isContainer = parent.tagName.toLowerCase() === 'body' || (parent.tagName.toLowerCase() === 'div' && parent.classList.contains('html-text'))

        if (isContainer) {
          return parent.firstElementChild === current
        }

        if (parent.firstElementChild !== current) return false
        current = parent
      }
      return false
    }

    const hideP = (anchor: Element): void => {
      const p = anchor.closest('p')
      if (p && isFirstElementChain(p)) {
        ;(p as HTMLElement).style.display = 'none'
      }
    }

    const metaSpan = context.container.querySelector('span#meta_content_hide_info')
    if (metaSpan) {
      hideP(metaSpan)
      return
    }

    const fallback = context.container.querySelector('span#profileBt') || context.container.querySelector('span#copyright_logo')
    if (fallback) {
      hideP(fallback)
    }
  }
}
