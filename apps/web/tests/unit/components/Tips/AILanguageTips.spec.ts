// Tips/AILanguageTips 组件单测
// 极简：一个 button + bubble，hover 触发 isShowBubble
// 第四期 Sprint B.2：源码已抽具名 onHover 替代内联回调，spec 通过 setupState.onHover 直接驱动
import AILanguageTips from '~~/app/components/Tips/AILanguageTips.vue'

import { mountWithApp } from '~~/tests/setup/mount'
import { describe, expect, it } from 'vitest'

describe('Tips/AILanguageTips', () => {
  it('mount → 渲染 .ai-language-tips + button + bubble-container', () => {
    const wrapper = mountWithApp(AILanguageTips)
    expect(wrapper.find('.ai-language-tips').exists()).toBe(true)
    expect(wrapper.find('button').exists()).toBe(true)
    expect(wrapper.find('.bubble-container').exists()).toBe(true)
  })

  it('button 内含 img', () => {
    const wrapper = mountWithApp(AILanguageTips)
    expect(wrapper.find('button img').exists()).toBe(true)
  })

  it('默认 isShowBubble=false → bubble-container v-show 隐藏', () => {
    const wrapper = mountWithApp(AILanguageTips)
    const bubble = wrapper.find('.bubble-container')
    expect(bubble.attributes('style') || '').toContain('display: none')
  })

  it('bubble-container 内含 i18n span', () => {
    const wrapper = mountWithApp(AILanguageTips)
    expect(wrapper.find('.bubble-container span').text().length).toBeGreaterThan(0)
  })

  it('onHover(true) → isShowBubble=true → bubble-container v-show 显示', async () => {
    const wrapper = mountWithApp(AILanguageTips)
    const setup = (wrapper.vm as unknown as { $: { setupState: { onHover: (state: boolean) => void } } }).$.setupState
    setup.onHover(true)
    await wrapper.vm.$nextTick()
    const bubble = wrapper.find('.bubble-container')
    expect(bubble.attributes('style') || '').not.toContain('display: none')
  })

  it('onHover(false) → isShowBubble=false → bubble-container v-show 隐藏', async () => {
    const wrapper = mountWithApp(AILanguageTips)
    const setup = (wrapper.vm as unknown as { $: { setupState: { onHover: (state: boolean) => void } } }).$.setupState
    setup.onHover(true)
    await wrapper.vm.$nextTick()
    setup.onHover(false)
    await wrapper.vm.$nextTick()
    const bubble = wrapper.find('.bubble-container')
    expect(bubble.attributes('style') || '').toContain('display: none')
  })
})
