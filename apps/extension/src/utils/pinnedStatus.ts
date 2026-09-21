// 写 shadow host 的 data 属性
import { type MessageType, MessageTypeAction } from '@/config/message'

const PINNED_ATTR = 'data-slax-pinned'

const setPinnedAttr = (shadowHost: HTMLElement, isOnToolbar: boolean) => {
  shadowHost.setAttribute(PINNED_ATTR, String(isOnToolbar))
}

const queryPinnedStatus = async (shadowHost: HTMLElement) => {
  try {
    const res = await browser.runtime.sendMessage<{ action: MessageTypeAction.QueryPinnedStatus }, { success: true; data: { isOnToolbar: boolean } } | { success: false }>({
      action: MessageTypeAction.QueryPinnedStatus
    })
    if (res?.success) setPinnedAttr(shadowHost, res.data.isOnToolbar)
  } catch {
    // 静默失败，等下次重试
  }
}

// background 推送为主，事件为兜底
export const watchPinnedStatus = (shadowHost: HTMLElement) => {
  queryPinnedStatus(shadowHost)

  const onMessage = (message: unknown) => {
    const receiveMessage = message as MessageType
    if (receiveMessage.action === MessageTypeAction.PinnedStatusUpdate) {
      setPinnedAttr(shadowHost, receiveMessage.isOnToolbar)
    }
  }
  browser.runtime.onMessage.addListener(onMessage)

  const onVisible = () => {
    if (document.visibilityState === 'visible') queryPinnedStatus(shadowHost)
  }
  document.addEventListener('visibilitychange', onVisible)

  return () => {
    browser.runtime.onMessage.removeListener(onMessage)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
