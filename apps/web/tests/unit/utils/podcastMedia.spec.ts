// podcastMedia：段落定位、「从这里听」取段首时间、跟随播放（高亮、滚动、手动滚动暂停、回到当前）
import { activeIndex, listenStartOf, MediaFollower, PLAYING_CLASS, PODCAST_EVENTS, positionKey, seekTo } from '~~/app/utils/podcastMedia'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const time = (t: number, playing = true) => window.dispatchEvent(new CustomEvent(PODCAST_EVENTS.time, { detail: { t, playing } }))

describe('podcastMedia helpers', () => {
  it('activeIndex: last start at or before t', () => {
    const starts = [0, 10_000, 20_000, 35_000]
    expect(activeIndex(starts, -1)).toBe(-1)
    expect(activeIndex(starts, 0)).toBe(0)
    expect(activeIndex(starts, 19_999)).toBe(1)
    expect(activeIndex(starts, 20_000)).toBe(2)
    expect(activeIndex(starts, 99_000)).toBe(3)
    expect(activeIndex([], 5)).toBe(-1)
  })

  it('listenStartOf: only inside a podcast article or translation', () => {
    document.body.innerHTML =
      '<article class="slax-pod-article"><p data-start-ms="12000"><b>x</b></p></article><p data-start-ms="5" id="plain">y</p><div class="podcast-translation"><p data-start-ms="7000">z</p></div>'
    expect(listenStartOf(document.querySelector('b')!.firstChild)).toBe(12000)
    expect(listenStartOf(document.querySelector('#plain')!.firstChild)).toBeNull()
    expect(listenStartOf(document.querySelector('.podcast-translation p')!)).toBe(7000)
    expect(listenStartOf(null)).toBeNull()
  })

  it('seekTo sends seconds on the shared seek event; positions are keyed by audio address', () => {
    const spy = vi.fn()
    window.addEventListener(PODCAST_EVENTS.seek, spy)
    seekTo(65_500)
    expect((spy.mock.calls[0]![0] as CustomEvent).detail).toEqual({ t: 65.5 })
    window.removeEventListener(PODCAST_EVENTS.seek, spy)
    expect(positionKey('https://a/b.mp3')).toBe('slax:podcast-pos:https://a/b.mp3')
  })
})

describe('MediaFollower', () => {
  let follower: MediaFollower
  let scrolled: string[]

  beforeEach(() => {
    document.body.innerHTML =
      '<div id="root"><article class="slax-pod-article"><p data-start-ms="0" id="p1">a</p><p data-start-ms="10000" id="p2">b</p><p data-start-ms="20000" id="p3">c</p></article></div>'
    scrolled = []
    for (const p of Array.from(document.querySelectorAll<HTMLElement>('[data-start-ms]'))) {
      p.scrollIntoView = () => void scrolled.push(p.id)
      // happy-dom has no layout: treat every paragraph as visible
      p.getClientRects = () => [{}] as unknown as DOMRectList
    }
    follower = new MediaFollower(() => document.getElementById('root'))
  })

  afterEach(() => follower.destroy())

  it('marks the paragraph being heard and scrolls to it while playing', () => {
    time(12)
    expect(document.getElementById('p2')!.classList.contains(PLAYING_CLASS)).toBe(true)
    time(25)
    expect(document.getElementById('p2')!.classList.contains(PLAYING_CLASS)).toBe(false)
    expect(document.getElementById('p3')!.classList.contains(PLAYING_CLASS)).toBe(true)
    expect(scrolled).toEqual(['p2', 'p3'])
  })

  it('paused: marks without scrolling', () => {
    time(12, false)
    expect(document.getElementById('p2')!.classList.contains(PLAYING_CLASS)).toBe(true)
    expect(scrolled).toEqual([])
  })

  it('a wheel from the reader stops following and says so; "back to current" scrolls again', () => {
    const follow = vi.fn()
    window.addEventListener(PODCAST_EVENTS.follow, follow)
    time(1)
    window.dispatchEvent(new Event('wheel'))
    expect((follow.mock.calls[0]![0] as CustomEvent).detail).toEqual({ following: false })
    time(12)
    expect(scrolled).toEqual(['p1'])
    window.dispatchEvent(new CustomEvent(PODCAST_EVENTS.follow, { detail: { following: true, scroll: true } }))
    expect(scrolled).toEqual(['p1', 'p2'])
    window.removeEventListener(PODCAST_EVENTS.follow, follow)
  })

  it('arrow keys in a text field do not stop following', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    time(1)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    time(12)
    expect(scrolled).toEqual(['p1', 'p2'])
  })

  it('destroy removes the mark and the listeners', () => {
    time(12)
    follower.destroy()
    expect(document.querySelector(`.${PLAYING_CLASS}`)).toBeNull()
    time(25)
    expect(document.querySelector(`.${PLAYING_CLASS}`)).toBeNull()
  })
})
