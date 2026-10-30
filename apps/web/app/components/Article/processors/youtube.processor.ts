import { YoutubePlayerElement } from '../CEComponents'
import { bindMediaText } from './podcast.processor'
import type { DOMProcessor, WebProcessorContext } from './types'

export class YoutubeProcessor implements DOMProcessor {
  readonly name = 'YoutubeProcessor'

  match(context: WebProcessorContext): boolean {
    return !!context.container.querySelector('youtube-player')
  }

  process(context: WebProcessorContext): void {
    const nodes = Array.from(context.container.querySelectorAll('youtube-player'))

    nodes.forEach(node => {
      if (!(node instanceof HTMLElement)) return

      const videoId = node.dataset['videoId'] || ''
      if (!videoId) return

      const element = new YoutubePlayerElement({ videoId })
      if (context.container.querySelector('[data-slax-derived="youtube-article"]')) {
        element.style.display = 'block'
        element.style.maxWidth = '440px'
        element.style.margin = '0 auto 24px'
      }
      node.parentElement?.replaceChild(element, node)
    })

    const articles = context.container.querySelectorAll('[data-slax-derived="youtube-article"]')
    for (const article of articles) {
      for (const heading of article.querySelectorAll<HTMLElement>('h2.slax-pod-heading[data-start-ms]')) {
        if (heading.querySelector('.slax-yt-chapter-time')) continue
        const raw = heading.dataset['startMs']
        if (!raw) continue
        const ms = Number(raw)
        if (!Number.isFinite(ms) || ms < 0) continue
        const seconds = Math.floor(ms / 1000)
        const minutes = Math.floor(seconds / 60)
        const suffix = String(seconds % 60).padStart(2, '0')
        const time = minutes < 60 ? `${minutes}:${suffix}` : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${suffix}`
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'slax-yt-chapter-time'
        button.textContent = time
        const seek = () => window.dispatchEvent(new CustomEvent('slax:youtube-seek', { detail: { t: seconds } }))
        button.addEventListener('click', seek)
        heading.appendChild(button)
        context.cleanups.push(() => {
          button.removeEventListener('click', seek)
          button.remove()
        })
      }
    }
    if (!articles.length && context.container.querySelector('.slax-pod-article')) bindMediaText(context)
    for (const contents of context.container.querySelectorAll<HTMLDetailsElement>('.slax-yt-contents')) {
      // Same boundary as isH5 (width <= 768) in useSnapshotLayout: 768 px is collapsed on both sides
      contents.open = window.matchMedia('(min-width: 769px)').matches
      const navigate = (event: Event) => {
        const link = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href^="#yt-topic-"]')
        if (!link) return
        const heading = context.container.querySelector(link.getAttribute('href')!)
        if (!heading) return
        event.preventDefault()
        heading.scrollIntoView({ block: 'start' })
      }
      contents.addEventListener('click', navigate)
      context.cleanups.push(() => contents.removeEventListener('click', navigate))
    }

    // 正文平铺字幕：时间戳点击/回车跳转。委托绑在容器上，避免逐条监听
    const transcript = context.container.querySelector('.slax-yt-transcript')
    if (!transcript) return

    // Keep the cue elements and text nodes intact for stored highlight selectors.
    const cues = Array.from(transcript.querySelectorAll<HTMLElement>(':scope > .slax-yt-cue'))
    let paragraphLength = 0
    let previousText = ''
    let previousTime = 0
    for (const [index, cue] of cues.entries()) {
      const text = cue.querySelector('.slax-yt-cue-text')?.textContent?.trim() ?? ''
      const stamp = cue.querySelector<HTMLElement>('.slax-yt-cue-time')
      const time = Number(stamp?.dataset['ytSeek'])
      const sentenceEnded = /[.!?。！？]["'”’)]?$/.test(previousText)
      const startsParagraph = index === 0 || /^>>/.test(text) ||
        (sentenceEnded && paragraphLength >= 360) || paragraphLength >= 900 ||
        (Number.isFinite(time) && time - previousTime >= 12)
      cue.toggleAttribute('data-yt-paragraph-start', startsParagraph)
      if (stamp) {
        stamp.hidden = !startsParagraph
        stamp.tabIndex = startsParagraph ? 0 : -1
        if (startsParagraph) stamp.removeAttribute('aria-hidden')
        else stamp.setAttribute('aria-hidden', 'true')
      }
      paragraphLength = (startsParagraph ? 0 : paragraphLength) + text.length
      previousText = text
      // A cue without a readable stamp keeps the last known time, so the pause break still works
      if (Number.isFinite(time)) previousTime = time
    }
    transcript.setAttribute('data-yt-reading', '')

    const seekFromTarget = (target: EventTarget | null) => {
      const el = (target as HTMLElement | null)?.closest('[data-yt-seek]')
      if (!el) return
      const t = Number(el.getAttribute('data-yt-seek'))
      if (Number.isFinite(t)) window.dispatchEvent(new CustomEvent('slax:youtube-seek', { detail: { t } }))
    }

    const onClick = (e: Event) => seekFromTarget(e.target)
    const onKeydown = (e: Event) => {
      const ke = e as KeyboardEvent
      if (ke.key !== 'Enter' && ke.key !== ' ') return
      if (!(ke.target as HTMLElement | null)?.closest('[data-yt-seek]')) return
      ke.preventDefault()
      seekFromTarget(ke.target)
    }

    transcript.addEventListener('click', onClick)
    transcript.addEventListener('keydown', onKeydown)

    context.cleanups.push(() => {
      transcript.removeEventListener('click', onClick)
      transcript.removeEventListener('keydown', onKeydown)
    })
  }
}
