import { WechatVideoInfoElement } from '../CEComponents'
import type { DOMProcessor, WebProcessorContext } from './types'

export class WechatVideoProcessor implements DOMProcessor {
  readonly name = 'WechatVideoProcessor'

  match(): boolean {
    return true
  }

  process(context: WebProcessorContext): void {
    const videos = Array.from(context.container.querySelectorAll('mp-common-videosnap')) as HTMLElement[]

    videos.forEach(video => {
      const data = {
        url: video.getAttribute('data-url'),
        headimgurl: video.getAttribute('data-headimgurl'),
        nickname: video.getAttribute('data-nickname'),
        desc: video.getAttribute('data-desc')
      }

      video.parentNode?.replaceChild(new WechatVideoInfoElement({ data }), video)
    })
  }
}
