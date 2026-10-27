// YoutubeProcessor: the player upgrade, the old raw transcript seek, and the AI article body
// (same markup as the podcast article): seek on time stamps, follow-along, "listen from here"
import { listenStartOf, PLAYING_CLASS, PODCAST_EVENTS } from '~~/app/utils/podcastMedia'

import { getElementFullSelector } from '@commons/frontend-utils/dom'
import { DetailsProcessor } from '~~/app/components/Article/processors/details.processor'
import type { WebProcessorContext } from '~~/app/components/Article/processors/types'
import { ArticleStyle } from '~~/app/components/Article/processors/types'
import { YoutubeProcessor } from '~~/app/components/Article/processors/youtube.processor'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('~~/app/components/Article/CEComponents', () => {
  class FakeYoutubePlayer extends HTMLElement {
    props: Record<string, string>
    constructor(props: Record<string, string>) {
      super()
      this.props = props
    }
  }
  if (!customElements.get('fake-youtube-player')) customElements.define('fake-youtube-player', FakeYoutubePlayer)
  return { YoutubePlayerElement: FakeYoutubePlayer }
})

// What the backend writes once the article is ready
const ARTICLE_BODY = `<div class="slax-yt" data-slax-derived="youtube">
<youtube-player data-video-id="dQw4w9WgXcQ" data-cues="[]"><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe></youtube-player>
<article class="slax-pod-article" data-slax-derived="youtube-article" data-article-version="v1" lang="en">
<p class="slax-pod-lede">Lede</p>
<section class="slax-pod-section">
<h2 class="slax-pod-heading" data-start-ms="0">Intro</h2>
<p class="slax-pod-p" data-start-ms="0" data-cue-ids="c0000"><span class="slax-pod-time" data-media-seek="0" role="button" tabindex="0">00:00</span> <b>First</b> paragraph.</p>
<p class="slax-pod-p" data-start-ms="65400" data-cue-ids="c0001"><span class="slax-pod-time" data-media-seek="65400" role="button" tabindex="0">01:05</span> Second paragraph.</p>
</section>
</article>
</div>`

const RAW_BODY = `<div class="slax-yt">
<youtube-player data-video-id="dQw4w9WgXcQ" data-cues="[]"></youtube-player>
  <div class="slax-yt-transcript">
    <p class="slax-yt-cue"><span class="slax-yt-cue-time" data-yt-seek="12" role="button" tabindex="0">00:12</span> <span class="slax-yt-cue-text">raw</span></p>
  </div>
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

const seeks = () => {
  const spy = vi.fn()
  window.addEventListener(PODCAST_EVENTS.seek, spy)
  return { spy, off: () => window.removeEventListener(PODCAST_EVENTS.seek, spy), times: () => spy.mock.calls.map(c => (c[0] as CustomEvent).detail.t) }
}

describe('YoutubeProcessor', () => {
  const processor = new YoutubeProcessor()
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('upgrades the player in place in both bodies', () => {
    for (const body of [ARTICLE_BODY, RAW_BODY]) {
      const ctx = context(body)
      expect(processor.match(ctx)).toBe(true)
      processor.process(ctx)
      expect(ctx.container.querySelector('youtube-player')).toBeNull()
      expect((ctx.container.querySelector('fake-youtube-player') as unknown as { props: Record<string, string> }).props).toEqual({ videoId: 'dQw4w9WgXcQ' })
      ctx.cleanups.forEach(fn => fn())
    }
  })

  it('article body: time stamps seek the video on click and Enter; cleanup removes the handlers', () => {
    const ctx = context(ARTICLE_BODY)
    processor.process(ctx)
    const s = seeks()
    const stamp = ctx.container.querySelectorAll<HTMLElement>('.slax-pod-time')[1]!
    stamp.click()
    stamp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(s.times()).toEqual([65.4, 65.4])
    ctx.cleanups.forEach(fn => fn())
    stamp.click()
    expect(s.spy).toHaveBeenCalledTimes(2)
    s.off()
  })

  it('article body: the paragraph being played is marked; only while the video plays does the text follow', () => {
    const ctx = context(ARTICLE_BODY)
    const scrolled: string[] = []
    const original = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolled.push(this.dataset['startMs'] ?? '')
    }
    // jsdom has no layout: every paragraph counts as shown
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
    processor.process(ctx)
    const paragraphs = ctx.container.querySelectorAll<HTMLElement>('.slax-pod-p')

    window.dispatchEvent(new CustomEvent(PODCAST_EVENTS.time, { detail: { t: 70, playing: false } }))
    expect(paragraphs[1]!.classList.contains(PLAYING_CLASS)).toBe(true)
    expect(scrolled).toEqual([])

    window.dispatchEvent(new CustomEvent(PODCAST_EVENTS.time, { detail: { t: 1, playing: true } }))
    expect(paragraphs[0]!.classList.contains(PLAYING_CLASS)).toBe(true)
    expect(paragraphs[1]!.classList.contains(PLAYING_CLASS)).toBe(false)
    expect(scrolled).toEqual(['0'])

    ctx.cleanups.forEach(fn => fn())
    expect(paragraphs[0]!.classList.contains(PLAYING_CLASS)).toBe(false)
    HTMLElement.prototype.scrollIntoView = original
    vi.restoreAllMocks()
  })

  it('article body: "listen from here" gets the start of the selected paragraph', () => {
    const ctx = context(ARTICLE_BODY)
    processor.process(ctx)
    expect(listenStartOf(ctx.container.querySelector('b')!.firstChild)).toBe(0)
    expect(listenStartOf(ctx.container.querySelectorAll('.slax-pod-p')[1]!.lastChild)).toBe(65400)
    expect(listenStartOf(ctx.container.querySelector('.slax-pod-lede')!.firstChild)).toBeNull()
  })

  it('groups caption cues without changing text nodes or highlight selectors', () => {
    const lines = [
      'This sentence continues', ' across two captions.',
      'Another complete sentence with enough detail to form a useful reading paragraph. '.repeat(5),
      'A new paragraph starts here.', '>> A different speaker answers', ' and finishes the answer.'
    ]
    const rows = lines.map((text, i) => `<p class="slax-yt-cue"><span class="slax-yt-cue-time" data-yt-seek="${i * 2}" tabindex="0" role="button">0:0${i * 2}</span> <span class="slax-yt-cue-text">${text}</span></p>`).join('\n')
    const ctx = context(RAW_BODY.replace(/<div class="slax-yt-transcript">[\s\S]*?<\/div>/, `<div class="slax-yt-transcript">${rows}</div>`))
    const transcript = ctx.container.querySelector('.slax-yt-transcript')!
    const before = transcript.textContent
    const nodes = [...transcript.querySelectorAll('.slax-yt-cue-text')].map(el => el.firstChild)
    const paths = nodes.map(node => getElementFullSelector(node!.parentElement!, ['slax-mark'], ctx.container))
    processor.process(ctx)
    expect(transcript.hasAttribute('data-yt-reading')).toBe(true)
    expect([...transcript.querySelectorAll('[data-yt-paragraph-start]')].map(el => [...transcript.children].indexOf(el))).toEqual([0, 3, 4])
    expect(transcript.textContent).toBe(before)
    expect(paths.map(path => ctx.container.querySelector(path)?.firstChild)).toEqual(nodes)
    expect([...transcript.querySelectorAll('.slax-yt-cue-text')].map(el => el.firstChild)).toEqual(nodes)
    expect(transcript.querySelectorAll('.slax-yt-cue-time[tabindex="0"]')).toHaveLength(3)
    expect(transcript.querySelectorAll('.slax-yt-cue-time[aria-hidden="true"]')).toHaveLength(3)
    ctx.cleanups.forEach(fn => fn())
  })

  it('breaks long unpunctuated runs and long pauses without removing cues', () => {
    const rows = [0, 2, 4, 30].map((time, i) => `<p class="slax-yt-cue"><span class="slax-yt-cue-time" data-yt-seek="${time}" tabindex="0">${time}</span><span class="slax-yt-cue-text">${i === 0 ? 'word '.repeat(190) : 'continued text'}</span></p>`).join('\n')
    const ctx = context(`<youtube-player data-video-id="video"></youtube-player><div class="slax-yt-transcript">${rows}</div>`)
    processor.process(ctx)
    const cues = [...ctx.container.querySelectorAll('.slax-yt-cue')]
    expect(cues.map(cue => cue.hasAttribute('data-yt-paragraph-start'))).toEqual([true, true, false, true])
    expect(cues).toHaveLength(4)
    ctx.cleanups.forEach(fn => fn())
  })

  it('keeps mobile contents collapsed and navigates without changing article nodes', () => {
    const ctx = context(ARTICLE_BODY.replace('<p class="slax-pod-lede">', '<details class="slax-yt-contents"><summary>Contents</summary><nav><a href="#yt-topic-0">Intro</a></nav></details><p class="slax-pod-lede">').replace('<h2 class="slax-pod-heading"', '<h2 id="yt-topic-0" class="slax-pod-heading"'))
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList)
    const heading = ctx.container.querySelector<HTMLElement>('h2')!
    const scroll = vi.fn()
    heading.scrollIntoView = scroll
    processor.process(ctx)
    new DetailsProcessor().process(ctx)
    expect(ctx.container.querySelector('details')!.open).toBe(false)
    ctx.container.querySelector<HTMLAnchorElement>('nav a')!.click()
    expect(scroll).toHaveBeenCalledWith({ block: 'start' })
    expect(ctx.container.querySelector('h2')).toBe(heading)
    ctx.cleanups.forEach(fn => fn())
    vi.restoreAllMocks()
  })

  it('raw body keeps the old transcript seek in whole seconds, and no follower', () => {
    const ctx = context(RAW_BODY)
    processor.process(ctx)
    const s = seeks()
    ctx.container.querySelector<HTMLElement>('.slax-yt-cue-time')!.click()
    expect(s.times()).toEqual([12])
    expect(listenStartOf(ctx.container.querySelector('.slax-yt-cue-text')!.firstChild)).toBeNull()
    s.off()
    ctx.cleanups.forEach(fn => fn())
  })
})
