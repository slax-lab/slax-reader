// PodcastTranslation：文本绑定渲染（XSS 样本不执行）、每段时间戳跳转、说话人标点随语言
import PodcastTranslation from '~~/app/components/Snapshot/PodcastTranslation.vue'

import { mountWithApp } from '~~/tests/setup/mount'
import { describe, expect, it, vi } from 'vitest'

const CONTENT = {
  version: 'v',
  language: 'zh',
  lede: '<img src=x onerror="window.__pwned=1">',
  sections: [{ heading: '标题', start_ms: 0, paragraphs: [{ speaker: '主持人', text: '<script>window.__pwned=1</script>第一段', start_ms: 3_725_000 }] }]
}

describe('PodcastTranslation', () => {
  it('renders text only, with a seek button per paragraph', async () => {
    const w = await mountWithApp(PodcastTranslation, { props: { content: CONTENT }, attachTo: document.body })
    expect(w.find('img').exists()).toBe(false)
    expect(w.find('script').exists()).toBe(false)
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
    expect(w.find('.pod-tr-p').attributes('data-start-ms')).toBe('3725000')
    expect(w.find('.pod-tr-time').text()).toBe('1:02:05')
    expect(w.find('.pod-tr-speaker').text()).toBe('主持人：')
    const seek = vi.fn()
    window.addEventListener('slax:youtube-seek', seek)
    await w.find('.pod-tr-time').trigger('click')
    expect((seek.mock.calls[0]![0] as CustomEvent).detail).toEqual({ t: 3725 })
    window.removeEventListener('slax:youtube-seek', seek)
    w.unmount()
  })
})


it('opens caption timestamps on YouTube without seeking podcast audio', async () => {
  const w = await mountWithApp(PodcastTranslation, { props: { content: { ...CONTENT, transcript_source_url: 'https://www.youtube.com/watch?v=Jv5B5CEaPJI' } }, attachTo: document.body })
  const link = w.find('.pod-tr-time')
  expect(link.element.tagName).toBe('A')
  expect(link.attributes('href')).toBe('https://www.youtube.com/watch?v=Jv5B5CEaPJI&t=3725')
  expect(w.find('.pod-tr-p').attributes('data-start-ms')).toBeUndefined()
  expect(w.find('.slax-yt-contents').exists()).toBe(true)
  w.unmount()
})
