// PodcastPlayer：跳转请求、进度广播、倍速、位置记忆、回到当前
import PodcastPlayer from '~~/app/components/Article/CEComponents/podcast/PodcastPlayer.ce.vue'

import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SRC = 'https://cdn.example.com/ep.mp3'

describe('PodcastPlayer', () => {
  let play: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    localStorage.clear()
    play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event('play'))
      return Promise.resolve()
    })
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event('pause'))
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  const mount = () => mountWithApp(PodcastPlayer, { props: { src: SRC, title: 'Ep 1', show: 'Show', cover: '', durationMs: '3600000' }, attachTo: document.body })

  it('shows the episode and its length before the audio loads', async () => {
    const w = await mount()
    expect(w.text()).toContain('Ep 1')
    expect(w.text()).toContain('Show')
    expect(w.text()).toContain('1:00:00')
    w.unmount()
  })

  it('a seek request moves the audio and plays; the time is broadcast', async () => {
    const w = await mount()
    const times = vi.fn()
    window.addEventListener('slax:youtube-time', times)
    window.dispatchEvent(new CustomEvent('slax:youtube-seek', { detail: { t: 420 } }))
    const audio = w.find('audio').element as HTMLAudioElement
    expect(audio.currentTime).toBe(420)
    expect(play).toHaveBeenCalled()
    expect((times.mock.calls.at(-1)![0] as CustomEvent).detail).toMatchObject({ t: 420 })
    window.removeEventListener('slax:youtube-time', times)
    w.unmount()
  })

  it('speed cycles and reaches the audio element', async () => {
    const w = await mount()
    const rate = w.find('.rate')
    await rate.trigger('click')
    expect((w.find('audio').element as HTMLAudioElement).playbackRate).toBe(1.25)
    expect(rate.text()).toBe('1.25×')
    w.unmount()
  })

  it('remembers the position on pause and restores it when the audio loads again', async () => {
    const w = await mount()
    window.dispatchEvent(new CustomEvent('slax:youtube-seek', { detail: { t: 600 } }))
    ;(w.find('audio').element as HTMLAudioElement).pause()
    expect(localStorage.getItem(`slax:podcast-pos:${SRC}`)).toBe('600')
    w.unmount()

    const w2 = await mount()
    const audio = w2.find('audio').element as HTMLAudioElement
    audio.dispatchEvent(new Event('loadedmetadata'))
    expect(audio.currentTime).toBe(600)
    expect(play).toHaveBeenCalledTimes(1)
    w2.unmount()
  })

  it('a seek before the audio loads wins over the saved position', async () => {
    localStorage.setItem(`slax:podcast-pos:${SRC}`, '300')
    const w = await mount()
    window.dispatchEvent(new CustomEvent('slax:youtube-seek', { detail: { t: 1200 } }))
    const audio = w.find('audio').element as HTMLAudioElement
    audio.dispatchEvent(new Event('loadedmetadata'))
    expect(audio.currentTime).toBe(1200)
    w.unmount()
  })

  it('the speed button names its value', async () => {
    const w = await mount()
    expect(w.find('.rate').attributes('aria-label')).toBe('Playback speed 1×')
    w.unmount()
  })

  it('"back to current" shows while playing after the reader scrolled away, and asks to follow again', async () => {
    const w = await mount()
    await w.find('.play').trigger('click')
    window.dispatchEvent(new CustomEvent('slax:podcast-follow', { detail: { following: false } }))
    await w.vm.$nextTick()
    const follow = vi.fn()
    window.addEventListener('slax:podcast-follow', follow)
    await w.find('.follow').trigger('click')
    expect((follow.mock.calls[0]![0] as CustomEvent).detail).toEqual({ following: true, scroll: true })
    expect(w.find('.follow').exists()).toBe(false)
    window.removeEventListener('slax:podcast-follow', follow)
    w.unmount()
  })
})

describe('PodcastPlayer styles', () => {
  it('the sticky :host rule is in an unscoped block (a scoped :host never matches the shadow host)', async () => {
    const { readFileSync } = await import('node:fs')
    const { parse } = await import('@vue/compiler-sfc')
    const { resolve } = await import('node:path')
    const source = readFileSync(resolve(process.cwd(), 'app/components/Article/CEComponents/podcast/PodcastPlayer.ce.vue'), 'utf8')
    const { descriptor } = parse(source)
    expect(descriptor.styles.filter(s => !s.scoped).some(s => /:host\s*\{[^}]*position:\s*sticky/.test(s.content))).toBe(true)
    expect(descriptor.styles.filter(s => s.scoped).some(s => s.content.includes(':host'))).toBe(false)
  })
})
