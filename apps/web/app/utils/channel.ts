import { isClient, isFunction, isPromise } from '@commons/utils/is'

export interface ChannelMessageData {
  archive: {
    id: number
    cancel: boolean
  }
  star: {
    id: number
    cancel: boolean
  }
  trashed: {
    id: number
    trashed: boolean
  }
  refresh: {
    type: 'page'
  }
}

type ChannelHandlerFunction = (name: keyof ChannelMessageData, data: Partial<ChannelMessageData>) => void | Promise<void>

const channel = isClient ? new BroadcastChannel('slax-reader-dweb') : null
channel &&
  (channel.onmessage = async (event: MessageEvent) => {
    if (!event.data) {
      return
    }

    const { name, data } = event.data as { name: keyof ChannelMessageData; data: unknown }
    for (const handler of handlers) {
      if (isFunction(handler)) {
        if (isPromise(handler)) {
          await handler(name, data)
        } else {
          handler(name, data)
        }
      }
    }
  })

window?.addEventListener('close', () => {
  channel?.close()
})

const handlers: ChannelHandlerFunction[] = []

// 发布通道消息
export const postChannelMessage = <K extends keyof ChannelMessageData>(name: keyof ChannelMessageData, data: ChannelMessageData[K]) => {
  channel?.postMessage({
    name,
    data: {
      [name]: data
    }
  })
}

// 添加通道消息处理器
export const addChannelMessageHandler = (handler: ChannelHandlerFunction) => {
  if (!handler || handlers.includes(handler)) {
    return
  }

  handlers.push(handler)
}

// 移除通道消息处理器
export const removeChannelMessageHandler = (handler: ChannelHandlerFunction) => {
  const index = handlers.indexOf(handler)
  if (index !== -1) {
    handlers.splice(index, 1)
  }
}
