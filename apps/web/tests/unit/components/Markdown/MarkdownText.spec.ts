// MarkdownText.vue 单测 —— 第五期 Sprint C.1
// 覆盖：基本渲染 / parseMarkdownText 调用 / parseHTML anchor 转换 / handleAnchors click → emit / watch text 变化触发 update
// 关键约束：
//  - parseMarkdownText 是 nuxt auto-import? 不，是显式 import from '@commons/frontend-utils/parse'，用 vi.mock
//  - 代码块配色改由 styles/code-highlight.css 消费 --slax-code-* token，组件不再 import 第三方样式表
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockParseMarkdownText } = vi.hoisted(() => ({
  mockParseMarkdownText: vi.fn((text: string) => `<p>${text}</p>`)
}))

vi.mock('@commons/frontend-utils/parse', () => ({
  parseMarkdownText: mockParseMarkdownText
}))

import MarkdownText from '~~/app/components/Markdown/MarkdownText.vue'

beforeEach(() => {
  mockParseMarkdownText.mockClear()
  mockParseMarkdownText.mockImplementation((text: string) => `<p>${text}</p>`)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Markdown/MarkdownText', () => {
  it('mount → 渲染 .markdown-text + .markdown-content + 调 parseMarkdownText', () => {
    const wrapper = mountWithApp(MarkdownText, { props: { text: 'hello' } })
    expect(wrapper.find('.markdown-text').exists()).toBe(true)
    expect(wrapper.find('.markdown-content').html()).toContain('<p>hello</p>')
    expect(mockParseMarkdownText).toHaveBeenCalledWith('hello')
  })

  it('parseHTML：把 anchor_xxx 链接转换为 .slax_link + data-link', () => {
    mockParseMarkdownText.mockReturnValue('<p><a href="anchor_42" rel="noopener">jump</a></p>')
    const wrapper = mountWithApp(MarkdownText, { props: { text: 'whatever' } })
    const html = wrapper.find('.markdown-content').html()
    expect(html).toContain('class="slax_link"')
    expect(html).toContain('data-link="anchor_42"')
  })

  it('parseHTML：非 anchor 链接保持原样', () => {
    mockParseMarkdownText.mockReturnValue('<p><a href="https://other" rel="noopener">x</a></p>')
    const wrapper = mountWithApp(MarkdownText, { props: { text: 'x' } })
    const html = wrapper.find('.markdown-content').html()
    expect(html).toContain('href="https://other"')
    expect(html).not.toContain('class="slax_link"')
  })

  it('handleAnchors：.slax_link click → emit anchorClick(linkId)', async () => {
    mockParseMarkdownText.mockReturnValue('<p><a href="anchor_99" rel="noopener">jump</a></p>')
    const wrapper = mountWithApp(MarkdownText, { props: { text: 'x' } })
    // 等 nextTick 完成 handleAnchors 执行
    await wrapper.vm.$nextTick()
    const slaxLink = wrapper.find('.slax_link').element as HTMLAnchorElement
    slaxLink.click()
    const events = wrapper.emitted('anchorClick')!
    expect(events).toHaveLength(1)
    expect(events[0]![0]).toBe('anchor_99')
  })

  it('handleAnchors 二次执行：已注册 onclick 不重复绑定', async () => {
    mockParseMarkdownText.mockReturnValue('<p><a href="anchor_1" rel="noopener">x</a></p>')
    const wrapper = mountWithApp(MarkdownText, { props: { text: 'a' } })
    await wrapper.vm.$nextTick()
    const slaxLink = wrapper.find('.slax_link').element as HTMLAnchorElement
    const firstHandler = slaxLink.onclick
    // 触发一次 update（更改 text）
    await wrapper.setProps({ text: 'b' })
    await wrapper.vm.$nextTick()
    // 二次 handleAnchors 跑过；handler 因 anchorDom.onclick 已存在被 return 跳过
    expect(slaxLink.onclick).toBe(firstHandler)
  })

  it('text 变化：watch 触发 update + parseMarkdownText 第二次调用', async () => {
    const wrapper = mountWithApp(MarkdownText, { props: { text: 'first' } })
    expect(mockParseMarkdownText).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ text: 'second' })
    expect(mockParseMarkdownText).toHaveBeenCalledTimes(2)
    expect(mockParseMarkdownText).toHaveBeenLastCalledWith('second')
  })

  it('parseMarkdownText 返回空字符串：渲染空 markdown-content', () => {
    mockParseMarkdownText.mockReturnValue('')
    const wrapper = mountWithApp(MarkdownText, { props: { text: '' } })
    expect(wrapper.find('.markdown-content').text()).toBe('')
    expect(wrapper.find('.markdown-content').element.children.length).toBe(0)
  })

  it('parseHTML：多个 anchor 全部转换', () => {
    mockParseMarkdownText.mockReturnValue('<a href="anchor_1" rel="noopener">a</a> middle <a href="anchor_2" rel="noopener">b</a>')
    const wrapper = mountWithApp(MarkdownText, { props: { text: 'multi' } })
    const links = wrapper.findAll('.slax_link')
    expect(links).toHaveLength(2)
    expect(links[0]!.attributes('data-link')).toBe('anchor_1')
    expect(links[1]!.attributes('data-link')).toBe('anchor_2')
  })
})
