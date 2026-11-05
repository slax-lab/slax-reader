import { YoutubePlayerElement } from '../CEComponents'
import { bindMediaText, bindReadableMedia } from './podcast.processor'
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

    bindReadableMedia(context, 'youtube')
    if (!context.container.querySelector('[data-slax-derived="youtube-article"]') && context.container.querySelector('.slax-pod-article')) bindMediaText(context)

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
