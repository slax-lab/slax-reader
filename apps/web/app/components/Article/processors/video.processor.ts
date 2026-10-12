import { UnsupportedVideoElement } from '../CEComponents'
import type { DOMProcessor, WebProcessorContext } from './types'

export class VideoProcessor implements DOMProcessor {
  readonly name = 'VideoProcessor'

  match(context: WebProcessorContext): boolean {
    return !context.url.host.includes('xiaohongshu.com') && !context.url.host.includes('x.com')
  }

  process(context: WebProcessorContext): void {
    const videos = Array.from(context.container.querySelectorAll('video')) as HTMLVideoElement[]

    videos.forEach(video => {
      const poster = video.getAttribute('poster')
      const unsupportVideo = new UnsupportedVideoElement({ poster })

      unsupportVideo.addEventListener('posterClick', () => {
        context.callbacks.websiteClick()
      })

      video.parentElement?.replaceChild(unsupportVideo, video)
    })
  }
}
