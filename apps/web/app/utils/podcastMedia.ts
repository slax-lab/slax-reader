// Podcast audio in the article: the event bridge between the player, the text and the transcript
// panel, the saved listening position, and the paragraph that follows playback.
// The seek and time events are the ones the YouTube player already uses, so the transcript panel
// works for both media without change.

export const PODCAST_EVENTS = {
  /** detail { t: seconds } — ask the player to jump there and play */
  seek: 'slax:youtube-seek',
  /** detail { t: seconds, playing } — the player's current time */
  time: 'slax:youtube-time',
  /** detail { following, scroll? } — the text follows playback, or the reader scrolled away */
  follow: 'slax:podcast-follow',
  /** detail { playing } */
  state: 'slax:podcast-state'
} as const

export const PLAYING_CLASS = 'slax-pod-playing'

/** Saved position per audio address: the same episode resumes in every bookmark of it. */
export const positionKey = (src: string) => `slax:podcast-pos:${src}`

export const seekTo = (ms: number) => {
  window.dispatchEvent(new CustomEvent(PODCAST_EVENTS.seek, { detail: { t: ms / 1000 } }))
}

/** Start (ms) of the podcast paragraph that holds this node, for "listen from here". Null outside a podcast article. */
export const listenStartOf = (node: Node | null | undefined): number | null => {
  const el = node instanceof Element ? node : (node?.parentElement ?? null)
  const paragraph = el?.closest<HTMLElement>('[data-start-ms]')
  if (!paragraph || !paragraph.closest('.slax-pod-article, .podcast-translation')) return null
  const ms = Number(paragraph.dataset['startMs'])
  return Number.isFinite(ms) ? ms : null
}

/** Index of the last start at or before `t` (starts sorted ascending), or -1. */
export const activeIndex = (starts: number[], t: number): number => {
  let lo = 0
  let hi = starts.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if ((starts[mid] ?? Infinity) <= t) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '])

/**
 * Marks the paragraph being heard and keeps it in view while the audio plays. A wheel, touch or
 * scroll key from the reader stops the following (the player then shows "back to current"); the
 * player's follow event starts it again. Paragraphs are read on every update, so a re-rendered
 * list (original and translation) needs no new instance.
 */
export class MediaFollower {
  private following = true
  private playing = false
  private active: HTMLElement | null = null
  private readonly listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = []

  constructor(
    private readonly root: () => HTMLElement | null,
    private readonly selector = '.slax-pod-article [data-start-ms]'
  ) {
    this.on(window, PODCAST_EVENTS.time, e => this.onTime(e as CustomEvent<{ t: number; playing?: boolean }>))
    this.on(window, PODCAST_EVENTS.follow, e => this.onFollow(e as CustomEvent<{ following: boolean; scroll?: boolean }>))
    this.on(window, 'wheel', () => this.userScrolled(), { passive: true })
    this.on(window, 'touchmove', () => this.userScrolled(), { passive: true })
    this.on(window, 'keydown', e => {
      const ke = e as KeyboardEvent
      const target = ke.target as HTMLElement | null
      if (SCROLL_KEYS.has(ke.key) && !target?.closest('input, textarea, [contenteditable="true"], button')) this.userScrolled()
    })
  }

  private on(target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions) {
    target.addEventListener(type, fn, opts)
    this.listeners.push([target, type, fn, opts])
  }

  private paragraphs(): HTMLElement[] {
    const root = this.root()
    // Hidden lists (the original while the translation shows) do not follow
    return root ? Array.from(root.querySelectorAll<HTMLElement>(this.selector)).filter(p => p.offsetParent !== null || p.getClientRects().length > 0) : []
  }

  private onTime(e: CustomEvent<{ t: number; playing?: boolean }>) {
    if (typeof e.detail?.playing === 'boolean') this.playing = e.detail.playing
    const ms = (e.detail?.t ?? 0) * 1000
    const list = this.paragraphs()
    const idx = activeIndex(
      list.map(p => Number(p.dataset['startMs'])),
      ms
    )
    const next = idx >= 0 ? (list[idx] ?? null) : null
    if (next === this.active) return
    this.active?.classList.remove(PLAYING_CLASS)
    this.active = next
    next?.classList.add(PLAYING_CLASS)
    if (next && this.following && this.playing) this.scrollTo(next)
  }

  private onFollow(e: CustomEvent<{ following: boolean; scroll?: boolean }>) {
    this.following = !!e.detail?.following
    if (this.following && e.detail?.scroll && this.active) this.scrollTo(this.active)
  }

  private userScrolled() {
    if (!this.playing || !this.following) return
    this.following = false
    window.dispatchEvent(new CustomEvent(PODCAST_EVENTS.follow, { detail: { following: false } }))
  }

  private scrollTo(el: HTMLElement) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  destroy() {
    this.active?.classList.remove(PLAYING_CLASS)
    for (const [target, type, fn, opts] of this.listeners) target.removeEventListener(type, fn, opts)
    this.listeners.length = 0
  }
}
