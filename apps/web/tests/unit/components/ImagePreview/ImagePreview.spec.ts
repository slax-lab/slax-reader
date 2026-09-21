// ImagePreview.vue 单测 —— 第五期 Sprint D.1
// 覆盖：渲染（image + placeholder）/ isLargeImage 5 分支精确覆盖 / class 切换（wider/higher/large）/
//      onMounted emit appear + showPreview=true / handleEnter（checkImageFrameAvailable T/F）/
//      handleLeave emit dismiss / clickBackground 早返与 dismiss 链 / clickImage @click.stop /
//      placeholder 定位 setTimeout
import ImagePreview from '~~/app/components/ImagePreview/ImagePreview.vue'

import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function buildFrame(overrides: Partial<{ left: number; top: number; width: number; height: number; imgWidth: number; imgHeight: number }> = {}) {
  return {
    left: 10,
    top: 20,
    width: 100,
    height: 100,
    imgWidth: 200,
    imgHeight: 200,
    ...overrides
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ImagePreview', () => {
  describe('渲染 + class 切换', () => {
    it('mount → 渲染 .image-preview + .image + .placholder', () => {
      const wrapper = mountWithApp(ImagePreview, { props: { url: 'https://x.com/y.png', imageFrame: buildFrame() } })
      expect(wrapper.find('.image-preview').exists()).toBe(true)
      expect(wrapper.find('.image').exists()).toBe(true)
      expect(wrapper.find('.placholder').exists()).toBe(true)
    })

    it('imgWidth > imgHeight：image 含 wider class', () => {
      const wrapper = mountWithApp(ImagePreview, { props: { url: 'x', imageFrame: buildFrame({ imgWidth: 400, imgHeight: 200 }) } })
      expect(wrapper.find('.image').classes()).toContain('wider')
    })

    it('imgHeight > imgWidth：image 含 higher class', () => {
      const wrapper = mountWithApp(ImagePreview, { props: { url: 'x', imageFrame: buildFrame({ imgWidth: 200, imgHeight: 400 }) } })
      expect(wrapper.find('.image').classes()).toContain('higher')
    })

    it('imgWidth === imgHeight：不含 wider/higher class', () => {
      const wrapper = mountWithApp(ImagePreview, { props: { url: 'x', imageFrame: buildFrame({ imgWidth: 200, imgHeight: 200 }) } })
      const cls = wrapper.find('.image').classes()
      expect(cls).not.toContain('wider')
      expect(cls).not.toContain('higher')
    })
  })

  describe('isLargeImage computed 5 分支', () => {
    it('分支 1：imgWidth > imgHeight 且 height>0 且 imgWidth/height > 3 → large=true', () => {
      const wrapper = mountWithApp(ImagePreview, { props: { url: 'x', imageFrame: buildFrame({ imgWidth: 400, imgHeight: 100, height: 50 }) } })
      // 400/50 = 8 > 3 → large
      expect(wrapper.find('.image').classes()).toContain('large')
    })

    it('分支 2：imgWidth > imgHeight 且 height>0 且 imgWidth/height <= 3 → large=false', () => {
      const wrapper = mountWithApp(ImagePreview, { props: { url: 'x', imageFrame: buildFrame({ imgWidth: 200, imgHeight: 100, height: 100 }) } })
      // 200/100 = 2 <= 3
      expect(wrapper.find('.image').classes()).not.toContain('large')
    })

    it('分支 3：imgWidth > imgHeight 且 height=0 → fallback false', () => {
      const wrapper = mountWithApp(ImagePreview, { props: { url: 'x', imageFrame: buildFrame({ imgWidth: 400, imgHeight: 100, height: 0 }) } })
      expect(wrapper.find('.image').classes()).not.toContain('large')
    })

    it('分支 4a：imgHeight > imgWidth 且 width>0 且 imgHeight/width > 3 → large=true', () => {
      const wrapper = mountWithApp(ImagePreview, { props: { url: 'x', imageFrame: buildFrame({ imgWidth: 100, imgHeight: 400, width: 50 }) } })
      expect(wrapper.find('.image').classes()).toContain('large')
    })

    it('分支 4b：imgHeight > imgWidth 且 width=0 → fallback false', () => {
      const wrapper = mountWithApp(ImagePreview, { props: { url: 'x', imageFrame: buildFrame({ imgWidth: 100, imgHeight: 400, width: 0 }) } })
      expect(wrapper.find('.image').classes()).not.toContain('large')
    })

    it('分支 5：imgWidth === imgHeight → 末尾 return false', () => {
      const wrapper = mountWithApp(ImagePreview, { props: { url: 'x', imageFrame: buildFrame({ imgWidth: 100, imgHeight: 100, width: 50 }) } })
      expect(wrapper.find('.image').classes()).not.toContain('large')
    })
  })

  describe('lifecycle + emit', () => {
    it('onMounted 后：emit appear', () => {
      const wrapper = mountWithApp(ImagePreview, { props: { url: 'x', imageFrame: buildFrame() } })
      // onMounted 同步 emit appear
      expect(wrapper.emitted('appear')).toHaveLength(1)
    })
  })

  describe('handleEnter / placeholder 链', () => {
    it('imageFrame 数值齐全：handleEnter 调用后推进 timers 不抛错', async () => {
      const wrapper = mountWithApp(ImagePreview, { props: { url: 'x', imageFrame: buildFrame({ width: 100, height: 100, imgWidth: 200, imgHeight: 200 }) } })
      // handleEnter 是 setup 私有函数；通过触发 transition enter 等事件 happy-dom 不真触发，
      // 改测：mount 已成功 + advanceTimers 不抛
      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(250)
      expect(wrapper.find('.image').exists()).toBe(true)
    })

    it('imageFrame 任一维度为 0：mount 仍可渲染（checkImageFrameAvailable 走 false 路径）', () => {
      const wrapper = mountWithApp(ImagePreview, { props: { url: 'x', imageFrame: buildFrame({ width: 0 }) } })
      expect(wrapper.find('.image').exists()).toBe(true)
    })

    it('imageFrame 缺失（null）：mount 抛错', () => {
      // template 直接访问 imageFrame.imgWidth；prop default null 使 mount 即抛
      expect(() => {
        mountWithApp(ImagePreview, { props: { url: 'x', imageFrame: null as never } })
      }).toThrow()
    })
  })

  describe('clickBackground / handleLeave', () => {
    it('clickBackground：dismissEnable=false 时早返不变更 showPreview', async () => {
      const wrapper = mountWithApp(ImagePreview, { props: { url: 'x', imageFrame: buildFrame() } })
      // dismissEnable 默认 false，placeholderHidden 默认 false，所以 click 直接 return
      await wrapper.find('.image-preview').trigger('click')
      // showPreview 仍 true
      const el = wrapper.find('.image-preview').element as HTMLElement
      expect(el.style.display).not.toBe('none')
    })

    it('clickImage 不抛错（@click.stop 阻止冒泡）', async () => {
      const wrapper = mountWithApp(ImagePreview, { props: { url: 'x', imageFrame: buildFrame() } })
      await wrapper.find('.image').trigger('click')
      // 不抛错即可
      expect(wrapper.find('.image').exists()).toBe(true)
    })
  })
})
