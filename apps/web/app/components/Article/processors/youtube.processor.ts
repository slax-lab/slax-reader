import { YoutubePlayerElement } from '../CEComponents'
import type { DOMProcessor, WebProcessorContext } from './types'

/**
 * 处理后端吐出的 YouTube 内容：
 * 1) 把 <youtube-player data-video-id> 源标签升级为视频播放器组件（YoutubePlayerElement）；
 *    源标签未被替换时内嵌的兜底 <iframe> 仍可直接播放。
 * 2) 给平铺在正文里的字幕时间戳（[data-yt-seek]）绑委托点击/回车，派发 slax:youtube-seek
 *    事件让播放器跳转（与侧栏字幕面板同一套事件桥）。正文字幕为真实 HTML，便于划线评论。
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
      node.parentElement?.replaceChild(element, node)
    })

    // 正文平铺字幕：时间戳点击/回车跳转。委托绑在容器上，避免逐条监听
    const transcript = context.container.querySelector('.slax-yt-transcript')
    if (!transcript) return

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
