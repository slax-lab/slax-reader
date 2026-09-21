// utils/channel.ts 测试套件 —— 第二期 sprint 6.1 Task 2.A
//
// 关键约束（详见 .claude/test-framework/phase2/sprint6.1-utils-light.md §1.4 + §3.4）：
// 1. BroadcastChannel 由模块顶层 `new BroadcastChannel(...)` 实例化；spec 用
//    vi.stubGlobal 在每个 beforeEach 内替换全局 BroadcastChannel，紧跟
//    vi.resetModules + 动态 import 让顶层副作用在 stub 之上重跑。
// 2. window.addEventListener('close', ...) 会被模块顶层注册；vi.resetModules
//    不移除 window listener，多次 import 会让 close listener 累积。本 spec
//    用 vi.spyOn 拦 window.addEventListener 捕获 close handler，close 用例
//    直接调 capturedCloseHandler.handler() 而非 window.dispatchEvent，避免累积。
// 3. handlers 数组是模块私有状态，spec 通过 onmessage 触发后观察 handler 被调
//    来间接验证 add / remove 的副作用，不直接读 handlers 引用。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { postMessageMock, closeMock, registeredOnmessage, capturedCloseHandler } = vi.hoisted(() => ({
  postMessageMock: vi.fn(),
  closeMock: vi.fn(),
  registeredOnmessage: { handler: null as ((e: MessageEvent) => void | Promise<void>) | null },
  capturedCloseHandler: { handler: null as (() => void) | null }
}))

class BroadcastChannelStub {
  name: string
  postMessage = postMessageMock
  close = closeMock

  constructor(name: string) {
    this.name = name
  }

  set onmessage(h: (e: MessageEvent) => void | Promise<void>) {
    registeredOnmessage.handler = h
  }
}

let channelModule: typeof import('~~/app/utils/channel')

beforeEach(async () => {
  // stubGlobal 必须每个 it 重新执行：afterEach 的 vi.unstubAllGlobals 清掉之后，
  // 下一个 it 不重新 stub 会让动态 import 拿到 happy-dom 真实 BroadcastChannel
  vi.stubGlobal('BroadcastChannel', BroadcastChannelStub)

  // spy 拦 window.addEventListener，捕获 close listener 留待用例直接调用，
  // 避免 vi.resetModules 后 listener 累积导致 closeMock 被多次触发
  capturedCloseHandler.handler = null
  vi.spyOn(window, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject) => {
    if (type === 'close' && typeof listener === 'function') {
      capturedCloseHandler.handler = listener as () => void
    }
  })

  vi.resetModules()
  postMessageMock.mockReset()
  closeMock.mockReset()
  registeredOnmessage.handler = null
  channelModule = await import('~~/app/utils/channel')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const triggerMessage = async (data: unknown) => {
  expect(registeredOnmessage.handler).toBeTypeOf('function')
  await registeredOnmessage.handler!({ data } as MessageEvent)
}

describe('addChannelMessageHandler', () => {
  it('添加 handler → onmessage 触发后该 handler 被调用', async () => {
    const handler = vi.fn()
    channelModule.addChannelMessageHandler(handler)
    await triggerMessage({ name: 'archive', data: { archive: { id: 1, cancel: false } } })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith('archive', { archive: { id: 1, cancel: false } })
  })

  it('重复添加同一 handler → onmessage 触发后只被调一次（去重生效）', async () => {
    const handler = vi.fn()
    channelModule.addChannelMessageHandler(handler)
    channelModule.addChannelMessageHandler(handler)
    await triggerMessage({ name: 'star', data: { star: { id: 2, cancel: true } } })
    expect(handler).toHaveBeenCalledTimes(1)
  })
})

describe('removeChannelMessageHandler', () => {
  it('移除已注册的 handler → onmessage 触发后该 handler 不再被调', async () => {
    const handler = vi.fn()
    channelModule.addChannelMessageHandler(handler)
    channelModule.removeChannelMessageHandler(handler)
    await triggerMessage({ name: 'archive', data: { archive: { id: 1, cancel: false } } })
    expect(handler).not.toHaveBeenCalled()
  })

  it('移除未注册的 handler → 不抛错且其它 handler 不受影响', async () => {
    const registered = vi.fn()
    const stranger = vi.fn()
    channelModule.addChannelMessageHandler(registered)
    expect(() => channelModule.removeChannelMessageHandler(stranger)).not.toThrow()
    await triggerMessage({ name: 'archive', data: { archive: { id: 9, cancel: false } } })
    expect(registered).toHaveBeenCalledTimes(1)
    expect(stranger).not.toHaveBeenCalled()
  })
})

describe('postChannelMessage', () => {
  it("调 postChannelMessage('archive', payload) → channel.postMessage 收到包装后的 envelope", () => {
    channelModule.postChannelMessage('archive', { id: 1, cancel: false })
    expect(postMessageMock).toHaveBeenCalledTimes(1)
    expect(postMessageMock).toHaveBeenCalledWith({
      name: 'archive',
      data: { archive: { id: 1, cancel: false } }
    })
  })
})

describe('channel.onmessage', () => {
  it('同步 handler 被调用并收到 (name, data) 参数', async () => {
    const syncHandler = vi.fn()
    channelModule.addChannelMessageHandler(syncHandler)
    await triggerMessage({ name: 'trashed', data: { trashed: { id: 7, trashed: true } } })
    expect(syncHandler).toHaveBeenCalledTimes(1)
    expect(syncHandler).toHaveBeenCalledWith('trashed', { trashed: { id: 7, trashed: true } })
  })

  it('async handler 被 await 调用，调用完成后 Promise 已 resolve', async () => {
    let resolveInner!: () => void
    const innerDone = new Promise<void>(resolve => {
      resolveInner = resolve
    })
    const asyncHandler = vi.fn(async (_name: string, _data: unknown) => {
      await innerDone
    })
    channelModule.addChannelMessageHandler(asyncHandler)

    // 启动 onmessage（不立刻 await，让 handler 进入 pending）
    const dispatch = registeredOnmessage.handler!({ data: { name: 'refresh', data: { refresh: { type: 'page' } } } } as MessageEvent)
    expect(asyncHandler).toHaveBeenCalledTimes(1)

    // 释放内部 Promise，dispatch 应随之 resolve（验证 await 生效）
    resolveInner()
    await dispatch
    expect(asyncHandler).toHaveBeenCalledWith('refresh', { refresh: { type: 'page' } })
  })

  it('event.data 为空 → 直接 return，不调 handlers', async () => {
    const handler = vi.fn()
    channelModule.addChannelMessageHandler(handler)
    await triggerMessage(null)
    expect(handler).not.toHaveBeenCalled()
  })
})

describe("window 'close' 事件", () => {
  it('触发被捕获的 close handler → channel.close() 被调', () => {
    expect(capturedCloseHandler.handler).toBeTypeOf('function')
    capturedCloseHandler.handler!()
    expect(closeMock).toHaveBeenCalledTimes(1)
  })
})
