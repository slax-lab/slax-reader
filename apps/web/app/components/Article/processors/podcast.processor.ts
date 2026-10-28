import { MediaFollower, seekTo } from '~/utils/podcastMedia'

import { PodcastPlayerElement } from '../CEComponents'
import type { DOMProcessor, WebProcessorContext } from './types'

/**
 * Cleaned media text (podcast or YouTube article, same markup): paragraph time stamps
 * ([data-media-seek], ms) seek the player on click or Enter/Space, and the paragraph being
 * played is marked and kept in view.
 */
export const bindMediaText = (context: WebProcessorContext): void => {
  // YouTube contents stay with YoutubeProcessor, so each contents element has one listener
  for (const contents of context.container.querySelectorAll<HTMLDetailsElement>('[data-slax-derived="podcast-article"] .slax-yt-contents')) {
    // Same boundary as isH5 (width <= 768) in useSnapshotLayout
    contents.open = window.matchMedia('(min-width: 769px)').matches
    const navigate = (event: Event) => {
      const link = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href^="#pod-topic-"]')
      if (!link) return
      const heading = context.container.querySelector(link.getAttribute('href')!)
      if (!heading) return
      event.preventDefault()
      heading.scrollIntoView({ block: 'start' })
    }
    contents.addEventListener('click', navigate)
    context.cleanups.push(() => contents.removeEventListener('click', navigate))
  }
  const seekFrom = (target: EventTarget | null): boolean => {
    const el = (target as HTMLElement | null)?.closest<HTMLElement>('[data-media-seek]')
    if (!el || !context.container.contains(el)) return false
    // Number('') is 0, so an empty attribute would seek to the start
    const raw = el.dataset['mediaSeek']
    if (!raw) return false
    const ms = Number(raw)
    if (!Number.isFinite(ms)) return false
    seekTo(ms)
    return true
  }
  const onClick = (e: Event) => void seekFrom(e.target)
  const onKeydown = (e: Event) => {
    const ke = e as KeyboardEvent
    if (ke.key !== 'Enter' && ke.key !== ' ') return
    if (seekFrom(ke.target)) ke.preventDefault()
  }
  context.container.addEventListener('click', onClick)
  context.container.addEventListener('keydown', onKeydown)

  const follower = new MediaFollower(() => context.container)

  context.cleanups.push(() => {
    context.container.removeEventListener('click', onClick)
    context.container.removeEventListener('keydown', onKeydown)
    follower.destroy()
  })
}

/**
 * Podcast bodies from the backend:
 * 1) <slax-media data-kind="audio"> becomes the audio player (PodcastPlayerElement), placed just
 *    above the body container: there it stays sticky over the original and the translation (rendered
 *    after the body), and stays out of the highlight engine. Until then the <audio controls> plays.
 * 2) Paragraph time stamps ([data-media-seek], ms) seek the player on click or Enter/Space.
 * 3) The paragraph being heard is marked and kept in view while the audio plays.
 */
export class PodcastProcessor implements DOMProcessor {
  readonly name = 'PodcastProcessor'

  match(context: WebProcessorContext): boolean {
    return !!context.container.querySelector('slax-media[data-kind="audio"], [data-slax-derived="podcast-article"]')
  }

  process(context: WebProcessorContext): void {
    for (const node of Array.from(context.container.querySelectorAll<HTMLElement>('slax-media[data-kind="audio"]'))) {
      const src = node.dataset['src'] || ''
      if (!/^https?:\/\//i.test(src)) continue
      const element = new PodcastPlayerElement({
        src,
        title: node.dataset['title'] || '',
        show: node.dataset['show'] || '',
        cover: /^https?:\/\//i.test(node.dataset['cover'] || '') ? node.dataset['cover'] : '',
        durationMs: node.dataset['durationMs'] || '0'
      })
      const host = context.container.parentElement
      if (host) {
        host.insertBefore(element, context.container)
        node.remove()
        context.cleanups.push(() => element.remove())
      } else {
        node.parentElement?.replaceChild(element, node)
      }
    }

    bindMediaText(context)
  }
}
