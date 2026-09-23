// PhotoSwipeProcessor 单测 —— 第四期 Sprint A.1.1
// 覆盖：仅 PhotoSwipeTopic 风格 match=true / 无 swiper 早返 / 注册 dotsEle + indexSelected 触发 scrollTo /
//      cleanups 注册移除 listener / 容器无 swiper 安全跳过
import { PhotoSwipeProcessor } from '~~/app/components/Article/processors/photo-swipe.processor'
import type { WebProcessorContext } from '~~/app/components/Article/processors/types'
import { ArticleStyle } from '~~/app/components/Article/processors/types'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('~~/app/components/Article/CEComponents', () => {
  // 注意：vi.mock factory 会 hoist 到文件顶部，无法引用文件内任何变量
  // 因此 FakeDots 在 factory 内定义并通过 (globalThis as any).__createdDots 暴露
  class FakeDots extends HTMLElement {
    count!: number
    selectIndex!: number
    constructor(props?: { count: number; selectIndex: number }) {
      super()
      if (props) {
        this.count = props.count
        this.selectIndex = props.selectIndex
        ;((globalThis as Record<string, unknown>).__createdDots as unknown[]).push(this)
      }
    }
  }
  if (!customElements.get('fake-photo-swipe-dots')) {
    customElements.define('fake-photo-swipe-dots', FakeDots)
  }
  return {
    PhotoSwiperDotsElement: FakeDots,
    UnsupportedVideoElement: class {},
    WechatVideoInfoElement: class {},
    TweetUserInfoElement: class {},
    TweetFooterInfoElement: class {}
  }
})

vi.mock('@vueuse/core', () => ({
  useDebounceFn: (fn: (...args: unknown[]) => unknown) => fn
}))

interface DotsLike extends HTMLElement {
  count: number
  selectIndex: number
}

function getCreated(): DotsLike[] {
  return ((globalThis as Record<string, unknown>).__createdDots as DotsLike[]) ?? []
}

function buildContext(html: string, articleStyle = ArticleStyle.PhotoSwipeTopic): WebProcessorContext {
  const container = document.createElement('div')
  container.innerHTML = html
  return {
    container,
    url: new URL('https://example.com/'),
    articleStyle,
    callbacks: { screenLockUpdate: () => {}, showImagePreview: () => {}, websiteClick: () => {} },
    cleanups: []
  }
}

;(globalThis as Record<string, unknown>).__createdDots = []

afterEach(() => {
  ;((globalThis as Record<string, unknown>).__createdDots as unknown[]).length = 0
  vi.restoreAllMocks()
})

describe('PhotoSwipeProcessor', () => {
  const processor = new PhotoSwipeProcessor()

  it('articleStyle=PhotoSwipeTopic：match=true', () => {
    expect(processor.match(buildContext('', ArticleStyle.PhotoSwipeTopic))).toBe(true)
  })

  it('articleStyle=Default：match=false', () => {
    expect(processor.match(buildContext('', ArticleStyle.Default))).toBe(false)
  })

  it('容器无 swiper：早返 + 不创建 dots', () => {
    const ctx = buildContext('<p>无 swiper</p>')
    processor.process(ctx)
    expect(getCreated()).toHaveLength(0)
  })

  it('正常路径：创建 dots / 注册 indexSelected / 滚动驱动 selectIndex', () => {
    const ctx = buildContext('<slax-photo-swipe-topic><div class="topic-container"><div class="swiper"><div></div><div></div><div></div></div></div></slax-photo-swipe-topic>')
    processor.process(ctx)
    const created = getCreated()
    expect(created).toHaveLength(1)
    const dots = created[0]!
    expect(dots.count).toBe(3)
    expect(dots.selectIndex).toBe(0)

    const swiper = ctx.container.querySelector('.swiper') as HTMLElement
    Object.defineProperty(swiper, 'clientWidth', { value: 100, configurable: true })
    const scrollSpy = vi.fn()
    ;(swiper as unknown as { scrollTo: (...args: unknown[]) => void }).scrollTo = scrollSpy

    dots.dispatchEvent(new CustomEvent('indexSelected', { detail: [2] }))
    expect(scrollSpy).toHaveBeenCalledWith({ left: 200, behavior: 'smooth' })

    Object.defineProperty(swiper, 'scrollLeft', { value: 100, configurable: true })
    swiper.dispatchEvent(new Event('scroll'))
    expect(dots.selectIndex).toBe(1)
  })

  it('indexSelected detail 异常（空数组）：早返不抛', () => {
    const ctx = buildContext('<slax-photo-swipe-topic><div class="topic-container"><div class="swiper"><div></div></div></div></slax-photo-swipe-topic>')
    processor.process(ctx)
    const created = getCreated()
    const dots = created[created.length - 1]!
    expect(() => dots.dispatchEvent(new CustomEvent('indexSelected', { detail: [] }))).not.toThrow()
  })

  it('cleanups 调用移除 listener', () => {
    const ctx = buildContext('<slax-photo-swipe-topic><div class="topic-container"><div class="swiper"><div></div></div></div></slax-photo-swipe-topic>')
    processor.process(ctx)
    expect(ctx.cleanups).toHaveLength(1)
    expect(() => ctx.cleanups[0]!()).not.toThrow()
  })
})
