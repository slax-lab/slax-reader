import { TweetFooterInfoElement } from '../CEComponents'
import type { DOMProcessor, WebProcessorContext } from './types'
import { ArticleStyle } from './types'

export class TweetProcessor implements DOMProcessor {
  readonly name = 'TweetProcessor'

  match(context: WebProcessorContext): boolean {
    return context.articleStyle === ArticleStyle.Twitter
  }

  process(context: WebProcessorContext): void {
    const tweetHeader = context.container.querySelector('tweet-header')
    if (tweetHeader && tweetHeader instanceof HTMLElement) {
      tweetHeader.remove()
    }

    const tweetFooter = context.container.querySelector('tweet-footer')
    if (tweetFooter && tweetFooter instanceof HTMLElement) {
      const tweetFooterElement = new TweetFooterInfoElement({
        replyCount: parseInt(tweetFooter.dataset['replyCount'] || '0'),
        retweetCount: parseInt(tweetFooter.dataset['retweetCount'] || '0'),
        favoriteCount: parseInt(tweetFooter.dataset['favoriteCount'] || '0')
      })

      tweetFooter.parentElement?.replaceChild(tweetFooterElement, tweetFooter)
    }
  }
}
