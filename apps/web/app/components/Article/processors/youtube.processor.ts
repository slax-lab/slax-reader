import { YoutubePlayerElement } from '../CEComponents'
import { bindMediaText } from './podcast.processor'
import type { DOMProcessor, WebProcessorContext } from './types'

/**
 * 处理后端吐出的 YouTube 内容：
 * 1) 把 <youtube-player data-video-id> 源标签升级为视频播放器组件（YoutubePlayerElement）；
 *    源标签未被替换时内嵌的兜底 <iframe> 仍可直接播放。
 * 2) 给平铺在正文里的字幕时间戳（[data-yt-seek]）绑委托点击/回车，派发 slax:youtube-seek
 *    事件让播放器跳转（与侧栏字幕面板同一套事件桥）。正文字幕为真实 HTML，便于划线评论。
 * 3) AI 整理稿已写进正文时（与播客同一套 .slax-pod-article 结构），段首时间戳跳转视频，
 *    正在播放的段落高亮并跟随。
 */
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

    if (context.container.querySelector('.slax-pod-article')) bindMediaText(context)
    for (const contents of context.container.querySelectorAll<HTMLDetailsElement>('.slax-yt-contents')) {
      contents.open = window.matchMedia('(min-width: 768px)').matches
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
      previousTime = time
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
