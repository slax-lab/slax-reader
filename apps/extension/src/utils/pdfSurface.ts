import { MessageTypeAction } from '@/config/message'
import { $t } from '@/utils/locale'

// Same motion as the page-save popup in Collect.vue (`popup-enter-from` / `popup-leave-to`): fade and slide
// from above over 250ms. Skipped when the user prefers reduced motion or the API is unavailable.
const MOTION = { duration: 250, easing: 'ease-in-out', fill: 'forwards' } as const
const HIDDEN = { opacity: 0, transform: 'translateY(-100%)' }
const SHOWN = { opacity: 1, transform: 'none' }
function canAnimate(frame: HTMLIFrameElement): boolean {
  return typeof frame.animate === 'function' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export function mountPdfCollectSurface(container: HTMLElement): { unmount: () => void } {
  let frame: HTMLIFrameElement | undefined
  const leaving = new Set<HTMLIFrameElement>()
  let operation = ''
  const resize = (height = 160) => {
    if (!frame) return
    frame.style.width = `${Math.max(160, Math.min(300, window.innerWidth - 16))}px`
    frame.style.height = `${Math.max(80, Math.min(height, window.innerHeight - 16))}px`
  }
  const onMessage = (message: Record<string, unknown>, sender: Browser.runtime.MessageSender, respond: (result: unknown) => void) => {
    if (sender.id !== browser.runtime.id) return false
    if (message.action === MessageTypeAction.ShowPdfCollectPopup && typeof message.operation === 'string') {
      if (operation !== message.operation || !frame?.isConnected) {
        frame?.remove()
        operation = message.operation
        frame = document.createElement('iframe')
        frame.title = $t('pdf_save.title')
        frame.src = browser.runtime.getURL('/pdf-save.html') + '?operation=' + encodeURIComponent(operation) + '&surface=inline'
        Object.assign(frame.style, { position: 'fixed', top: '8px', right: '8px', border: '0', borderRadius: '16px',
          boxShadow: '0 20px 60px #0000001a', zIndex: '99999999999', background: 'white' })
        container.appendChild(frame)
        resize()
        if (canAnimate(frame)) frame.animate([HIDDEN, SHOWN], MOTION)
      }
      frame?.focus()
      respond({ ready: true })
    } else if (message.action === MessageTypeAction.PdfCollectSurfaceUpdate && message.operation === operation) {
      if (message.method === 'resize' && typeof message.height === 'number') resize(message.height)
      if (message.method === 'close') {
        const closing = frame
        frame = undefined; operation = ''
        if (closing && canAnimate(closing)) {
          // Detached from `frame` first so a new save action can mount a fresh overlay while this one fades out.
          closing.style.pointerEvents = 'none'
          leaving.add(closing)
          closing.animate([SHOWN, HIDDEN], MOTION).addEventListener('finish', () => { leaving.delete(closing); closing.remove() })
        } else closing?.remove()
      }
      respond({ ready: true })
    }
    return false
  }
  const bindFrame = (event: MessageEvent) => {
    const url = new URL(browser.runtime.getURL('/pdf-save.html'))
    if (!event.isTrusted || event.source !== frame?.contentWindow || event.origin !== `${url.protocol}//${url.host}` ||
      event.data?.type !== 'slax-pdf-frame-ready' || event.data.operation !== operation ||
      typeof event.data.frameId !== 'number' || typeof event.data.token !== 'string') return
    // Only the isolated source controller can confirm its actual iframe window.
    // A website-created sibling cannot bind itself by copying a visible operation ID.
    void browser.runtime.sendMessage({ target: 'pdf-save', method: 'bind', owner: 'source-controller',
      operation, frameId: event.data.frameId, token: event.data.token }).catch(() => {})
  }
  browser.runtime.onMessage.addListener(onMessage)
  window.addEventListener('message', bindFrame)
  return { unmount() {
    browser.runtime.onMessage.removeListener(onMessage)
    window.removeEventListener('message', bindFrame)
    frame?.remove()
    leaving.forEach(item => item.remove())
    leaving.clear()
  } }
}
