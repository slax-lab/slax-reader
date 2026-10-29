import { describe, test, expect } from 'vitest'
import { HtmlBuilder } from '@/utils/htmlBuilder'
import type { XHSData } from '@/const/moreapi/xhs'
import type { RedditData } from '@/const/moreapi/reddit'

// 社媒卡片产出 social-post-* 结构，不再复用 tweet-*。
// 缺省字段不输出 data-*；data-* 转义；null 不崩溃。

const xhsItem = {
  user: { user_id: 'u1', nickname: '小明', avatar: 'https://cdn/a.jpg' },
  ip_location: '上海',
  note_id: 'n1',
  time: 1700000000000,
  last_update_time: 1700000001000,
  title: '标题',
  desc: '正文内容',
  video: {} as any,
  image_list: [{ url_default: 'https://cdn/img1.jpg', info_list: [], url: '', url_pre: '', width: 0, height: 0, file_id: '', trace_id: '', stream: {}, live_photo: false }],
  tag_list: [{ name: '美食' } as any],
  interact_info: { liked_count: '10', comment_count: '2', share_count: '1' } as any
} as unknown as XHSData

const redditItem: RedditData = {
  id: 't3_x',
  title: 'Reddit Title',
  content: 'body',
  contentHtml: '',
  author: { name: 'alice', avatar: 'https://cdn/av.jpg' },
  subreddit: { name: 'programming', title: 'Programming', icon: null },
  createdAt: '2024-01-01T00:00:00Z',
  score: 99,
  commentCount: 8,
  url: 'https://reddit.com/x',
  permalink: '/r/programming/comments/x',
  media: { type: 'image', images: ['https://cdn/r.jpg'] }
}

describe('HtmlBuilder.buildXhs', () => {
  const html = HtmlBuilder.buildXhs(xhsItem)

  test('产出 social-post 结构，不含 tweet-*', () => {
    expect(html).toContain('<div class="social-post">')
    expect(html).toContain('<social-post-header')
    expect(html).toContain('data-platform="xhs"')
    expect(html).toContain('class="social-post-content"')
    expect(html).toContain('<social-post-footer')
    expect(html).not.toContain('class="tweet"')
    expect(html).not.toContain('tweet-header')
    expect(html).not.toContain('tweet-content')
    expect(html).not.toContain('tweet-footer')
  })

  test('footer 输出真实互动指标', () => {
    expect(html).toContain('data-like-count="10"')
    expect(html).toContain('data-comment-count="2"')
    expect(html).toContain('data-share-count="1"')
  })

  test('标题只在正文，头部不输出 data-title', () => {
    expect(html).toContain('<div class="social-post-title">标题</div>')
    expect(html).not.toContain('data-title=')
  })

  test('number 型 created-at 不崩溃并归一为字符串', () => {
    expect(html).toContain('data-created-at="1700000000000"')
  })
})

describe('HtmlBuilder.buildWeibo', () => {
  test('缺省 followers/description 不输出，未认证不输出 data-verified', () => {
    const html = HtmlBuilder.buildWeibo({
      user: { screen_name: '博主', avatar_hd: 'https://cdn/w.jpg', verified: false },
      created_at: 'Wed Oct 25 12:00:00 +0800 2023',
      text_raw: '微博正文',
      comments_count: 3,
      reposts_count: 4,
      attitudes_count: 5
    })
    expect(html).toContain('data-platform="weibo"')
    expect(html).not.toContain('data-followers=')
    expect(html).not.toContain('data-description=')
    expect(html).not.toContain('data-verified=')
    expect(html).toContain('data-repost-count="4"')
    expect(html).not.toContain('class="tweet"')
  })

  test('认证用户输出 data-verified="true"，data-* 转义', () => {
    const html = HtmlBuilder.buildWeibo({
      user: { screen_name: '博"主"', verified: true },
      created_at: '',
      text_raw: ''
    })
    expect(html).toContain('data-verified="true"')
    expect(html).toContain('data-name="博&quot;主&quot;"')
  })
})

describe('HtmlBuilder.buildReddit', () => {
  const html = HtmlBuilder.buildReddit(redditItem)

  test('产出 social-post 结构与平台指标（score/comment/link，无转发点赞）', () => {
    expect(html).toContain('data-platform="reddit"')
    expect(html).toContain('data-score="99"')
    expect(html).toContain('data-comment-count="8"')
    expect(html).toContain('data-reddit-link="https://reddit.com/r/programming/comments/x"')
    expect(html).not.toContain('data-retweet-count')
    expect(html).not.toContain('data-favorite-count')
    expect(html).not.toContain('class="tweet"')
  })

  test('u/ r/ 前缀', () => {
    expect(html).toContain('data-screen-name="u/alice"')
    expect(html).toContain('data-location="r/programming"')
  })

  test('media 缺失不崩溃', () => {
    expect(() => HtmlBuilder.buildReddit({ ...redditItem, media: undefined as unknown as RedditData['media'] })).not.toThrow()
  })
})

// buildTweet 正文：entities.urls 换成 <a>，媒体 / 引用推文的 t.co 隐藏，文本转义，\n 保留。
const tweetBase = {
  id: '100',
  url: 'https://x.com/u/status/100',
  text: '',
  author: { name: 'User', userName: 'u', profilePicture: '', url: 'https://x.com/u' },
  replyCount: 1,
  retweetCount: 2,
  likeCount: 3,
  quoted_tweet: null
}

const urlEntity = (text: string, tco: string, expanded: string, display: string, from = 0) => {
  const start = Array.from(text.slice(0, text.indexOf(tco, from))).length
  return { url: tco, expanded_url: expanded, display_url: display, indices: [start, start + tco.length] }
}

const content = (html: string) => html.match(/<div class="tweet-content">([\s\S]*?)<\/div>/)![1]

describe('HtmlBuilder.buildTweet', () => {
  test('url entity 输出 <a href=expanded rel=noopener>display</a>，其余文本不变', () => {
    const text = 'Look at this https://t.co/abc now'
    const item = { ...tweetBase, text, entities: { urls: [urlEntity(text, 'https://t.co/abc', 'https://example.com/page?a=1&b=2', 'example.com/page')] } } as any
    const html = HtmlBuilder.buildTweet(item)
    expect(html.startsWith('<div class="tweet">')).toBe(true)
    expect(content(html)).toBe('Look at this <a href="https://example.com/page?a=1&amp;b=2" rel="noopener">example.com/page</a> now')
  })

  test('正文转义，\\n 保留', () => {
    const item = { ...tweetBase, text: 'a <script>x</script>\nb & c', entities: { urls: [] } } as any
    expect(content(HtmlBuilder.buildTweet(item))).toBe('a &lt;script&gt;x&lt;/script&gt;\nb &amp; c')
  })

  test('媒体 t.co 不显示，行尾空白去掉', () => {
    const text = 'photo time https://t.co/pic'
    const media = { type: 'photo', media_url_https: 'https://pbs/p.jpg', url: 'https://t.co/pic', indices: [11, 27] }
    const item = { ...tweetBase, text, entities: { urls: [] }, extendedEntities: { media: [media] } } as any
    const html = HtmlBuilder.buildTweet(item)
    expect(content(html)).toBe('photo time')
    expect(html).toContain('<img src="https://pbs/p.jpg"')
  })

  test('引用推文的 t.co：有引用卡片时隐藏，没有时显示为链接', () => {
    const text = 'agree https://t.co/q'
    const quoted = { ...tweetBase, id: '200', url: 'https://x.com/o/status/200' }
    const item = {
      ...tweetBase,
      text,
      quoted_tweet: quoted,
      entities: { urls: [urlEntity(text, 'https://t.co/q', 'https://x.com/o/status/200', 'x.com/o/status/200')] }
    } as any
    expect(content(HtmlBuilder.buildTweet(item, '<div class="quote-tweet"></div>'))).toBe('agree')
    expect(content(HtmlBuilder.buildTweet(item, ''))).toBe('agree <a href="https://x.com/o/status/200" rel="noopener">x.com/o/status/200</a>')
  })

  test('链接前有 emoji，位置按码点计算仍正确', () => {
    const text = '🔥🔥 hot https://t.co/e'
    const item = { ...tweetBase, text, entities: { urls: [urlEntity(text, 'https://t.co/e', 'https://hot.example', 'hot.example')] } } as any
    expect(content(HtmlBuilder.buildTweet(item))).toBe('🔥🔥 hot <a href="https://hot.example" rel="noopener">hot.example</a>')
  })

  test('同一条 t.co 出现两次，两处都是链接', () => {
    const text = 'https://t.co/d and https://t.co/d'
    const first = urlEntity(text, 'https://t.co/d', 'https://d.example', 'd.example')
    const second = urlEntity(text, 'https://t.co/d', 'https://d.example', 'd.example', 5)
    const item = { ...tweetBase, text, entities: { urls: [first, second] } } as any
    expect(content(HtmlBuilder.buildTweet(item))).toBe('<a href="https://d.example" rel="noopener">d.example</a> and <a href="https://d.example" rel="noopener">d.example</a>')
  })

  test('indices 越界或重叠的 entity 跳过，不抛错', () => {
    const text = 'short https://t.co/x'
    const bad = { url: 'https://t.co/x', expanded_url: 'https://x.example', display_url: 'x.example', indices: [6, 99] }
    const item = { ...tweetBase, text, entities: { urls: [bad] } } as any
    expect(content(HtmlBuilder.buildTweet(item))).toBe('short https://t.co/x')
  })

  test('entities 缺失时用正则把裸 URL 包成链接', () => {
    const item = { ...tweetBase, text: 'see https://example.com/a?b=1 <ok>' } as any
    expect(content(HtmlBuilder.buildTweet(item))).toBe('see <a href="https://example.com/a?b=1" rel="noopener">https://example.com/a?b=1</a> &lt;ok&gt;')
  })

  test('视频媒体：有 video_info 输出 <video>（取最后一个 variant），t.co 隐藏', () => {
    const text = 'watch this https://t.co/vid'
    const media = {
      type: 'video',
      media_url_https: 'https://pbs/v.jpg',
      url: 'https://t.co/vid',
      indices: [11, 27],
      video_info: { variants: [{ url: 'https://video/low.mp4' }, { url: 'https://video/high.mp4' }] }
    }
    const item = { ...tweetBase, text, entities: { urls: [] }, extendedEntities: { media: [media] } } as any
    const html = HtmlBuilder.buildTweet(item)
    expect(content(html)).toBe('watch this')
    expect(html).toContain('<video controls preload="metadata" poster="https://pbs/v.jpg" src="https://video/high.mp4"')
  })

  test('视频媒体缺 video_info 不崩溃、不输出 <video>，t.co 仍隐藏', () => {
    const text = 'watch this https://t.co/vid'
    const media = { type: 'video', media_url_https: 'https://pbs/v.jpg', url: 'https://t.co/vid', indices: [11, 27] }
    const item = { ...tweetBase, text, entities: { urls: [] }, extendedEntities: { media: [media] } } as any
    const html = HtmlBuilder.buildTweet(item)
    expect(content(html)).toBe('watch this')
    expect(html).not.toContain('<video')
  })

  test('extendedEntities 与 entities 同时缺失不崩溃', () => {
    const item = { ...tweetBase, text: 'plain text only' } as any
    expect(content(HtmlBuilder.buildTweet(item))).toBe('plain text only')
  })
})
