import { SocialPostFooterInfoElement, SocialPostUserInfoElement } from '../CEComponents'
import type { DOMProcessor, WebProcessorContext } from './types'
import { ArticleStyle } from './types'

/**
 * social-post 标签替换为 CE。
 * dataset 原样透传，缺省隐藏。
 */
export class SocialPostProcessor implements DOMProcessor {
  readonly name = 'SocialPostProcessor'

  match(context: WebProcessorContext): boolean {
    return context.articleStyle === ArticleStyle.SocialPost
  }

  process(context: WebProcessorContext): void {
    const header = context.container.querySelector('social-post-header')
    if (header && header instanceof HTMLElement) {
      const headerElement = new SocialPostUserInfoElement({
        platform: header.dataset['platform'],
        href: header.dataset['href'],
        avatar: header.dataset['avatar'],
        name: header.dataset['name'],
        description: header.dataset['description'],
        screenName: header.dataset['screenName'],
        location: header.dataset['location'],
        website: header.dataset['website'],
        createdAt: header.dataset['createdAt'],
        followers: header.dataset['followers'],
        followings: header.dataset['followings'],
        verified: header.dataset['verified']
      })

      header.parentElement?.replaceChild(headerElement, header)
    }

    const footer = context.container.querySelector('social-post-footer')
    if (footer && footer instanceof HTMLElement) {
      const footerElement = new SocialPostFooterInfoElement({
        platform: footer.dataset['platform'],
        likeCount: footer.dataset['likeCount'],
        commentCount: footer.dataset['commentCount'],
        shareCount: footer.dataset['shareCount'],
        repostCount: footer.dataset['repostCount'],
        score: footer.dataset['score'],
        redditLink: footer.dataset['redditLink']
      })

      footer.parentElement?.replaceChild(footerElement, footer)
    }
  }
}
