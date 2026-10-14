// PodcastProcessor：slax-media 换成播放器、只接受 http(s) 地址、段首时间戳点击和键盘跳转、清理
import { PodcastProcessor } from '~~/app/components/Article/processors/podcast.processor'
import type { WebProcessorContext } from '~~/app/components/Article/processors/types'
import { ArticleStyle } from '~~/app/components/Article/processors/types'
import { describe, expect, it, vi } from 'vitest'

vi.mock('~~/app/components/Article/CEComponents', () => {
  class FakePodcastPlayer extends HTMLElement {
    props: Record<string, string>
    constructor(props: Record<string, string>) {
      super()
      this.props = props
    }
  }
  if (!customElements.get('fake-podcast-player')) customElements.define('fake-podcast-player', FakePodcastPlayer)
  return { PodcastPlayerElement: FakePodcastPlayer }
})

const BODY = `<div class="slax-pod">
<slax-media data-kind="audio" data-src="https://cdn.example.com/ep.mp3" data-title="Ep" data-show="Show" data-cover="javascript:alert(1)" data-duration-ms="180000"><audio controls src="https://cdn.example.com/ep.mp3"></audio></slax-media>
<article class="slax-pod-article"><p class="slax-pod-p" data-start-ms="12000"><span class="slax-pod-time" data-media-seek="12000" role="button" tabindex="0">00:12</span> Text</p></article>
</div>`

function context(html: string): WebProcessorContext {
  const container = document.createElement('div')
  container.innerHTML = html
  document.body.appendChild(container)
  return {
    container,
    url: new URL('https://example.com/'),
    articleStyle: ArticleStyle.Default,
    callbacks: { screenLockUpdate: () => {}, showImagePreview: () => {}, websiteClick: () => {} },
    cleanups: []
  }
}

describe('PodcastProcessor', () => {
  const processor = new PodcastProcessor()

  it('matches only an audio slax-media', () => {
    expect(processor.match(context(BODY))).toBe(true)
    expect(processor.match(context('<p>x</p>'))).toBe(false)
  })

  it('puts the player just above the body (sticky over original and translation), dropping a non-http cover', () => {
    const ctx = context(BODY)
    processor.process(ctx)
    expect(ctx.container.querySelector('slax-media')).toBeNull()
    expect(ctx.container.querySelector('fake-podcast-player')).toBeNull()
    const player = ctx.container.previousElementSibling as HTMLElement & { props: Record<string, string> }
    expect(player.tagName).toBe('FAKE-PODCAST-PLAYER')
    expect(player.props).toEqual({ src: 'https://cdn.example.com/ep.mp3', title: 'Ep', show: 'Show', cover: '', durationMs: '180000' })
    ctx.cleanups.forEach(fn => fn())
    expect(ctx.container.previousElementSibling).toBeNull()
  })

  it('a non-http audio address keeps the original tag', () => {
    const ctx = context(BODY.replace('data-src="https://cdn.example.com/ep.mp3"', 'data-src="javascript:alert(1)"'))
    processor.process(ctx)
    expect(ctx.container.querySelector('slax-media')).not.toBeNull()
  })

  it('time stamps seek on click and on Enter; cleanup removes the handlers', () => {
    const ctx = context(BODY)
    processor.process(ctx)
    const seek = vi.fn()
    window.addEventListener('slax:youtube-seek', seek)
    const stamp = ctx.container.querySelector<HTMLElement>('.slax-pod-time')!
    stamp.click()
    stamp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(seek.mock.calls.map(c => (c[0] as CustomEvent).detail)).toEqual([{ t: 12 }, { t: 12 }])
    ctx.cleanups.forEach(fn => fn())
    stamp.click()
    expect(seek).toHaveBeenCalledTimes(2)
    window.removeEventListener('slax:youtube-seek', seek)
  })

  it('an empty seek attribute does nothing (Number("") would seek to the start)', () => {
    const ctx = context(BODY)
    processor.process(ctx)
    const seek = vi.fn()
    window.addEventListener('slax:youtube-seek', seek)
    const stamp = ctx.container.querySelector<HTMLElement>('.slax-pod-time')!
    stamp.setAttribute('data-media-seek', '')
    stamp.click()
    expect(seek).not.toHaveBeenCalled()
    window.removeEventListener('slax:youtube-seek', seek)
  })
})
