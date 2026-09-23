// DOMPipeline 单测 —— 第四期 Sprint A.1.1
// 覆盖：register 链式 / match=false 跳过 process / process 抛异常被 console.error 捕获不影响后续 / 异步 processor 等待完成
import { DOMPipeline } from '~~/app/components/Article/processors/pipeline'
import type { DOMProcessor, WebProcessorContext } from '~~/app/components/Article/processors/types'
import { ArticleStyle } from '~~/app/components/Article/processors/types'
import { afterEach, describe, expect, it, vi } from 'vitest'

function buildContext(): WebProcessorContext {
  return {
    container: document.createElement('div'),
    url: new URL('https://example.com/'),
    articleStyle: ArticleStyle.Default,
    callbacks: {
      screenLockUpdate: () => {},
      showImagePreview: () => {},
      websiteClick: () => {}
    },
    cleanups: []
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DOMPipeline', () => {
  it('register() 返回 this 支持链式', () => {
    const pipeline = new DOMPipeline()
    const noop: DOMProcessor = { name: 'noop', match: () => true, process: () => {} }
    expect(pipeline.register(noop)).toBe(pipeline)
  })

  it('match=true：调用 process', async () => {
    const pipeline = new DOMPipeline()
    const proc: DOMProcessor = { name: 'p1', match: vi.fn(() => true), process: vi.fn() }
    pipeline.register(proc)
    await pipeline.run(buildContext())
    expect(proc.process).toHaveBeenCalledTimes(1)
  })

  it('match=false：跳过 process', async () => {
    const pipeline = new DOMPipeline()
    const proc: DOMProcessor = { name: 'p1', match: vi.fn(() => false), process: vi.fn() }
    pipeline.register(proc)
    await pipeline.run(buildContext())
    expect(proc.process).not.toHaveBeenCalled()
  })

  it('process 抛异常：console.error 捕获 + 不影响后续 processor', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pipeline = new DOMPipeline()
    const failing: DOMProcessor = {
      name: 'failing',
      match: () => true,
      process: () => {
        throw new Error('boom')
      }
    }
    const after: DOMProcessor = { name: 'after', match: () => true, process: vi.fn() }
    pipeline.register(failing).register(after)
    await pipeline.run(buildContext())
    expect(errorSpy).toHaveBeenCalledWith('[failing]', expect.any(Error))
    expect(after.process).toHaveBeenCalledTimes(1)
  })

  it('异步 processor：等待 promise 完成', async () => {
    const pipeline = new DOMPipeline()
    const order: string[] = []
    const asyncProc: DOMProcessor = {
      name: 'async',
      match: () => true,
      process: async () => {
        await Promise.resolve()
        order.push('async-done')
      }
    }
    const after: DOMProcessor = {
      name: 'after',
      match: () => true,
      process: () => {
        order.push('after')
      }
    }
    pipeline.register(asyncProc).register(after)
    await pipeline.run(buildContext())
    expect(order).toEqual(['async-done', 'after'])
  })
})
