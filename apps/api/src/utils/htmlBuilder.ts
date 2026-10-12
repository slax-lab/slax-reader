import { XHSData } from '@/const/moreapi/xhs'
import { TweetArticleInfo, TweetInfo } from '@/const/twitterapi/struct'
import { RedditData } from '@/const/moreapi/reddit'
import { TikHubWeixinContent, parseWeixinCreateTime } from '@/const/moreapi/weixin'
import { renderTweetText } from '@/utils/tweetText'

const escAttr = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

export interface SlaxTopic {
  nickName: string
  avatar: string
  title: string
  desc: string
  imgs: string[]
}

export interface YoutubeCue {
  t: number
  text: string
}

export class HtmlBuilder {
  public static buildTweet(item: TweetInfo, quoteTweetHtml?: string): string {
    const tweetStyle =
      item.extendedEntities?.media?.map(media => {
        if (media.type === 'photo') {
          return `<img src="${media.media_url_https}" alt="Tweet Media">`
        }
        if (media.type === 'video' && media.video_info && media.video_info.variants && media.video_info.variants.length > 0) {
          const variantUrl = media.video_info.variants[media.video_info.variants.length - 1].url
          return `<video controls preload="metadata" poster="${media.media_url_https}" src="${variantUrl}" style="max-width: 100%; max-height: 500px; width: auto; height: auto; object-fit: contain;"></video>`
        }
        return ''
      }) || []

    return `<div class="tweet">
              <tweet-header
                  data-avatar="${item.author.profilePicture}" 
                  data-href="${item.author.url}"
                  data-name="${item.author.name}"
                  data-screen-name="${item.author.userName}"
                  data-description="${item.author.description}"
                  data-location="${item.author.location}"
                  data-website="${item.author.twitterUrl}"
                  data-created-at="${item.author.createdAt}"
                  data-followers="${item.author.followers}"
                  data-followings="${item.author.following}"
                  data-avatar="${item.author.profilePicture}" 
                  data-href="${item.author.url}"
                  data-name="${item.author.name}"
                  data-screen-name="${item.author.userName}"
                  data-description="${item.author.description}"
                  data-location="${item.author.location}"
                  data-website="${item.author.twitterUrl}"
                  data-created-at="${item.author.createdAt}"
                  data-followers="${item.author.followers}"
                  data-followings="${item.author.following}"
              ></tweet-header>
              <div class="tweet-media">${tweetStyle.join('\n')}</div>
              <div class="tweet-content">${renderTweetText(item, !!quoteTweetHtml)}</div>
              ${quoteTweetHtml ? `<div class="quote-tweet-container">${quoteTweetHtml}</div>` : ''}
              <tweet-footer
                  data-reply-count="${item.replyCount}"
                  data-retweet-count="${item.retweetCount}"
                  data-favorite-count="${item.likeCount}">
              </tweet-footer>
          </div>`
  }

  private static applyInlineStyles(text: string, ranges?: import('@/const/twitterapi/struct').InlineStyleRange[]): string {
    if (!ranges || ranges.length === 0) return text

    // Build a list of open/close tags at each character offset
    const tags: { pos: number; tag: string }[] = []
    for (const range of ranges) {
      const open = range.style === 'Bold' ? '<strong>' : range.style === 'Italic' ? '<em>' : range.style === 'Underline' ? '<u>' : range.style === 'Code' ? '<code>' : ''
      const close = range.style === 'Bold' ? '</strong>' : range.style === 'Italic' ? '</em>' : range.style === 'Underline' ? '</u>' : range.style === 'Code' ? '</code>' : ''
      if (!open) continue
      tags.push({ pos: range.offset, tag: open })
      tags.push({ pos: range.offset + range.length, tag: close })
    }
    tags.sort((a, b) => a.pos - b.pos)

    let result = ''
    let cursor = 0
    for (const { pos, tag } of tags) {
      result += text.slice(cursor, pos) + tag
      cursor = pos
    }
    result += text.slice(cursor)
    return result
  }

  private static renderArticleBlock(block: import('@/const/twitterapi/struct').ArticleContentBlock): string {
    if (block.type === 'image') {
      return `<img src="${block.url}" width="${block.width}" height="${block.height}" alt="Article Image">`
    }
    const styledText = HtmlBuilder.applyInlineStyles(block.text, block.inlineStyleRanges)
    switch (block.type) {
      case 'header-one':
        return `<h1>${styledText}</h1>`
      case 'header-two':
        return `<h2>${styledText}</h2>`
      case 'unordered-list-item':
        return `<li>${styledText}</li>`
      case 'ordered-list-item':
        return `<li>${styledText}</li>`
      default:
        return styledText ? `<p>${styledText}</p>` : '<br>'
    }
  }

  public static buildTweetArticle(item: TweetArticleInfo): string {
    const tweetStyle = item.cover_media_img_url ? [`<img src="${item.cover_media_img_url}" alt="Tweet Media">`] : []
    const contentHtml = item.contents.map(block => HtmlBuilder.renderArticleBlock(block)).join('\n')

    return `
      <html>
        <body>
          <div class="tweet">
            <tweet-header
                data-avatar="${item.author.profilePicture}"
                data-href="${item.author.url}"
                data-name="${item.author.name}"
                data-screen-name="${item.author.userName}"
                data-description="${item.author.description}"
                data-location="${item.author.location}"
                data-website="${item.author.twitterUrl}"
                data-created-at="${item.author.createdAt}"
                data-followers="${item.author.followers}"
                data-followings="${item.author.following}"
                data-avatar="${item.author.profilePicture}"
                data-href="${item.author.url}"
                data-name="${item.author.name}"
                data-screen-name="${item.author.userName}"
                data-description="${item.author.description}"
                data-location="${item.author.location}"
                data-website="${item.author.twitterUrl}"
                data-created-at="${item.author.createdAt}"
                data-followers="${item.author.followers}"
                data-followings="${item.author.following}"
            ></tweet-header>
            <div class="tweet-media">${tweetStyle.join('\n')}</div>
            <div class="tweet-content">${item.title ? `<h1 class="article-title">${item.title}</h1>` : ''}${contentHtml}</div>
            <tweet-footer
                data-reply-count="${item.replyCount}"
                data-favorite-count="${item.likeCount}">
            </tweet-footer>
          </div>
        </body>
      </html>`
  }

  public static buildTweetArticleWithDocument(document: Document): string {
    const avatarUrl = document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')
    const title = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || document.querySelector('title')?.textContent || ''
    const description = document.querySelector('meta[property="og:description"]')?.getAttribute('content') || ''
    const url = document.querySelector('meta[property="og:url"]')?.getAttribute('content') || ''
    const bodyContent = document.body.querySelector('article')?.outerHTML || document.body.innerHTML
    return `
      <html>
          <body>
            <div class="tweet">
              <tweet-header
                  data-avatar="${avatarUrl}"
                  data-screen-name="${description}"
                  data-description="${description}"
                  data-location="${url}"
                  data-website="${url}"
                  data-href="${url}"
                  data-name="${title}"
              ></tweet-header>
              <div class="tweet-content">${bodyContent}</div>
            </div>
          </body>
        </html>`
  }

  public static buildVideo(document: Document, url: string, poster: string) {
    const video = document.createElement('video')
    video.setAttribute('src', url)
    video.setAttribute('poster', poster)
    video.setAttribute('style', 'max-width: 100%; max-height: 500px; width: auto; height: auto; object-fit: contain;')
    return video
  }

  /** 微信图片流：合成 customerParser 所需 DOM（暂不含头像/昵称） */
  public static buildWeixinShowerPage(c: TikHubWeixinContent): string {
    // 图片流文案：\n → <br> 避免塌成一行
    const desc = (c.content_noencode || '').replace(/\n/g, '<br>')
    const imgs = (c.picture_page_info_list ?? [])
      .filter(p => p.cdn_url)
      .map(p => `<div class="swiper_item"><div class="swiper_item_img"><img id="img_item_placeholder" src="${escAttr(p.cdn_url)}"></div></div>`)
      .join('')
    // 数字时间戳先归一，避免 moment 解析失败
    const publishTime = /^\d+$/.test(c.create_time || '') ? parseWeixinCreateTime(c.create_time).toISOString() : c.create_time || ''
    return `<html><head><meta property="og:title" content="${escAttr(c.title)}"></head><body>
      <div id="js_article">
        <h1 class="rich_media_title">${escAttr(c.title)}</h1>
        <div id="publish_time">${escAttr(publishTime)}</div>
        <div id="img_swiper"><div id="img_swiper_content">${imgs}</div></div>
        <div id="js_image_desc">${desc}</div>
      </div></body></html>`
  }

  /** 微信普通文章：合成文章页交 Readability 过滤（暂不含头像/昵称/作者） */
  public static buildWeixinArticlePage(c: TikHubWeixinContent): string {
    // 数字时间戳先归一，避免 moment 解析失败
    const publishTime = /^\d+$/.test(c.create_time || '') ? parseWeixinCreateTime(c.create_time).toISOString() : c.create_time || ''
    return `<html><head><meta property="og:title" content="${escAttr(c.title)}"></head><body>
      <div id="js_article">
        <h1 class="rich_media_title">${escAttr(c.title)}</h1>
        <div id="publish_time">${escAttr(publishTime)}</div>
        <div class="rich_media_content" id="js_content">${c.content_noencode}</div>
      </div></body></html>`
  }

  public static buildSlaxTopic(document: Document, slaxTopic: SlaxTopic) {
    const fragment = document.createDocumentFragment()
    const slaxTopicDom = document.createElement('slax-photo-swipe-topic')

    slaxTopicDom.innerHTML = `
      <div class="topic-container">
        <div class="photo-section">
          <div class="swiper">
            ${slaxTopic.imgs
              .map(
                img => `
              <div class="swiper-slide">
                <img src="${img}">
              </div>
            `
              )
              .join('')}
          </div>
        </div>
        <div class="text-section">
          <div class="author">
            <img src="${slaxTopic.avatar}">
            <span class="nickname">${slaxTopic.nickName}</span>
          </div>
          <div class="title">${slaxTopic.title}</div>
          <div class="desc">${slaxTopic.desc}</div>
        </div>
      </div>
    `

    fragment.appendChild(slaxTopicDom)
    return fragment.firstElementChild as HTMLElement
  }

  public static buildXhs(item: XHSData): string {
    // 处理视频
    let videoHtml = ''
    if (item.video && item.video.media && item.video.media.stream) {
      let videoUrl = ''

      if (item.video.media.stream.h264 && item.video.media.stream.h264.length > 0) {
        videoUrl = item.video.media.stream.h264[0].master_url
      } else if (item.video.media.stream.h265 && item.video.media.stream.h265.length > 0) {
        videoUrl = item.video.media.stream.h265[0].master_url
      }

      if (videoUrl) {
        videoHtml = `<video src="${escAttr(videoUrl)}" controls style="max-width: 100%; max-height: 500px; width: auto; height: auto; object-fit: contain;">您的设备不支持视频播放。</video>`
      }
    }

    // 处理图片
    const imgs = (item.image_list || [])
      .map(img => {
        const imageUrl =
          img.url_default || (img.info_list && img.info_list.find(info => info.image_scene === 'WB_DFT')?.url) || (img.info_list && img.info_list[0]?.url) || img.url || ''
        return imageUrl ? `<img src="${escAttr(imageUrl)}" alt="XHS Image">` : ''
      })
      .filter(img => img)
      .join('')

    const mediaHtml = `${videoHtml}${imgs}`
    const tags = (item.tag_list || [])
      .filter(tag => tag && tag.name)
      .map(tag => `<span class="social-post-tag">#${tag.name}</span>`)
      .join(' ')
    const interact = item.interact_info

    // 标题只在正文展示，头部不重复渲染
    const header = HtmlBuilder.buildSocialPostHeader('xhs', {
      'data-avatar': item.user?.avatar,
      'data-user-id': item.user?.user_id,
      'data-name': item.user?.nickname,
      'data-screen-name': item.user?.nickname,
      'data-location': item.ip_location,
      'data-note-id': item.note_id,
      'data-created-at': item.time,
      'data-last-update': item.last_update_time
    })
    const footer = HtmlBuilder.buildSocialPostFooter('xhs', {
      'data-like-count': interact?.liked_count,
      'data-comment-count': interact?.comment_count,
      'data-share-count': interact?.share_count
    })

    return `<div class="social-post">
              ${header}
              <div class="social-post-content">
                ${item.title ? `<div class="social-post-title">${item.title}</div>` : ''}
                ${(item.desc || '').trim()}
                ${tags ? `<div class="social-post-tags">${tags}</div>` : ''}
              </div>
              ${mediaHtml ? `<div class="social-post-media">${mediaHtml}</div>` : ''}
              ${footer}
          </div>`
  }

  public static buildWeibo(item: any): string {
    // item: WeiboData
    let imgs = ''
    if (item.pic_infos && item.pic_ids && Array.isArray(item.pic_ids)) {
      imgs = item.pic_ids
        .map((id: string) => {
          const pic = item.pic_infos[id]
          return pic ? `<img src="${escAttr(pic.large?.url || pic.bmiddle?.url || pic.thumbnail?.url || '')}" alt="Weibo Image">` : ''
        })
        .join('')
    }

    // 部分字段某些路径下不存在，缺省不输出
    const header = HtmlBuilder.buildSocialPostHeader('weibo', {
      'data-avatar': item.user?.avatar_hd || item.user?.profile_image_url,
      'data-user-id': item.user?.id || item.user?.idstr,
      'data-name': item.user?.screen_name,
      'data-screen-name': item.user?.screen_name,
      'data-description': item.user?.description,
      'data-location': item.user?.location,
      'data-created-at': item.created_at,
      'data-followers': item.user?.followers_count,
      'data-followings': item.user?.friends_count,
      // 仅认证用户输出 true，未认证不输出
      'data-verified': item.user?.verified ? 'true' : undefined
    })
    const footer = HtmlBuilder.buildSocialPostFooter('weibo', {
      'data-comment-count': item.comments_count,
      'data-repost-count': item.reposts_count,
      'data-like-count': item.attitudes_count
    })

    return `<div class="social-post">
              ${header}
              <div class="social-post-content">${item.text_raw || item.text || ''}</div>
              ${imgs ? `<div class="social-post-media">${imgs}</div>` : ''}
              ${footer}
          </div>`
  }

  public static buildReddit(item: RedditData): string {
    // media 可能缺失，兜底 text 防解引用崩溃
    const media = item.media ?? ({ type: 'text' } as RedditData['media'])
    let mediaHtml = ''

    if (media.type === 'video' && media.videoUrl) {
      const posterAttr = media.thumbnail ? `poster="${escAttr(media.thumbnail)}"` : ''
      mediaHtml = `<video src="${escAttr(media.videoUrl)}" ${posterAttr} controls style="max-width: 100%; max-height: 500px; width: auto; height: auto; object-fit: contain;">您的设备不支持视频播放。</video>`
    } else if ((media.type === 'image' || media.type === 'gallery') && media.images && media.images.length > 0) {
      mediaHtml = media.images.map(img => `<img src="${escAttr(img)}" alt="Reddit Image">`).join('')
    } else if (media.type === 'link' && media.thumbnail) {
      mediaHtml = `<a href="${escAttr(item.url)}" target="_blank"><img src="${escAttr(media.thumbnail)}" alt="Link Preview"></a>`
    }

    // Reddit 只有 score/评论数，字段做 null 安全
    const header = HtmlBuilder.buildSocialPostHeader('reddit', {
      'data-avatar': item.author?.avatar,
      'data-name': item.author?.name,
      'data-screen-name': item.author?.name ? `u/${item.author.name}` : undefined,
      'data-description': item.subreddit?.title,
      'data-location': item.subreddit?.name ? `r/${item.subreddit.name}` : undefined,
      'data-subreddit': item.subreddit?.name,
      'data-subreddit-icon': item.subreddit?.icon,
      'data-created-at': item.createdAt
    })
    const footer = HtmlBuilder.buildSocialPostFooter('reddit', {
      'data-score': item.score,
      'data-comment-count': item.commentCount,
      'data-reddit-link': item.permalink ? `https://reddit.com${item.permalink}` : undefined
    })

    return `<div class="social-post">
              ${header}
              <div class="social-post-content">
                ${item.title ? `<div class="social-post-title"><strong>${item.title}</strong></div>` : ''}
                ${(item.content || '').trim()}
              </div>
              ${mediaHtml ? `<div class="social-post-media">${mediaHtml}</div>` : ''}
              ${footer}
          </div>`
  }

  private static escapeHtml(s: unknown): string {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  /** 拼接非空 data-* 属性，空值不输出（前端据此隐藏） */
  private static socialAttrs(attrs: Record<string, unknown>): string {
    return Object.entries(attrs)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}="${escAttr(v)}"`)
      .join('\n                  ')
  }

  /** 社媒卡片头部（小红书/微博/Reddit 共用） */
  private static buildSocialPostHeader(platform: string, attrs: Record<string, unknown>): string {
    return `<social-post-header
                  data-platform="${platform}"
                  ${HtmlBuilder.socialAttrs(attrs)}
              ></social-post-header>`
  }

  /** 社媒卡片底部，仅输出真实互动指标 */
  private static buildSocialPostFooter(platform: string, metrics: Record<string, unknown>): string {
    return `<social-post-footer
                  data-platform="${platform}"
                  ${HtmlBuilder.socialAttrs(metrics)}
              ></social-post-footer>`
  }

  private static fmtCueTime(sec: number): string {
    const s = Math.floor(sec % 60)
      .toString()
      .padStart(2, '0')
    const totalM = Math.floor(sec / 60)
    if (totalM < 60) return `${totalM}:${s}`
    const h = Math.floor(totalM / 60)
    const m = (totalM % 60).toString().padStart(2, '0')
    return `${h}:${m}:${s}`
  }

  public static buildYoutube(videoId: string, cues: YoutubeCue[]): string {
    // cues JSON 放进 data-* 属性，escapeHtml 处理属性上下文转义（" & < > '）
    const cuesAttr = HtmlBuilder.escapeHtml(JSON.stringify(cues))
    const player = `<youtube-player data-video-id="${videoId}" data-cues="${cuesAttr}">
  <iframe src="https://www.youtube.com/embed/${videoId}" style="width:100%;aspect-ratio:16/9;border:0;" frameborder="0" allowfullscreen></iframe>
</youtube-player>`

    if (!cues.length) return player

    const rows = cues
      .map(cue => {
        const ts = HtmlBuilder.fmtCueTime(cue.t)
        return `    <p class="slax-yt-cue"><span class="slax-yt-cue-time" data-yt-seek="${cue.t}" role="button" tabindex="0">${ts}</span> <span class="slax-yt-cue-text">${HtmlBuilder.escapeHtml(cue.text)}</span></p>`
      })
      .join('\n')

    return `<div class="slax-yt">
${player}
  <div class="slax-yt-transcript">
${rows}
  </div>
</div>`
  }

  public static buildQuoteTweet(document: Document) {
    const avatarUrl = document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')
    const mediaImageUrl = document.querySelector('meta[property="og:image"]')?.getAttribute('content') || ''
    const title = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || document.querySelector('title')?.textContent || ''
    const description = document.querySelector('meta[property="og:description"]')?.getAttribute('content') || ''
    const url = document.querySelector('meta[property="og:url"]')?.getAttribute('content') || ''
    return `<div class="quote-tweet">
              <div class="quote-header">
                ${avatarUrl ? `<img src="${avatarUrl}" alt="Quote Tweet Avatar" class="quote-avatar">` : ''}
                <div class="quote-title">${title}</div>
              </div>
              <div class="quote-description">${description}</div>
              <div class="quote-media">
                 ${mediaImageUrl ? `<img src="${mediaImageUrl}" alt="Quote Tweet Image">` : ''}
              </div>
              <a href="${url}" target="_blank" class="quote-link">查看原文</a>
          </div>`
  }
}
