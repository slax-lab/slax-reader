import type { DOMProcessor, SsrRewriter, WebProcessorContext } from './types'

/**
 * 给 v-html 正文 class 加 `oc-` 前缀，避免被全站 UnoCSS 原子类误伤；reader 依赖的 class 保留（见 RESERVED_*）。
 * 必须排在 pipeline 最前，以隔离后续 processor 产出的 class。
 */

const PREFIX = 'oc-'

// reader 正文样式（layers/core/styles/article/*.scss）直接依赖的内容态 class：保持原样。
const RESERVED_EXACT = new Set([
  // 通用 / 列表
  'has-li',
  'img-caption',
  // 知乎问答卡片（_custom-classes.scss）
  'zhihu-qa',
  'zhihu-qa-answer',
  'zhihu-qa-user',
  'zhihu-qa-avatar',
  'zhihu-qa-user-info',
  'zhihu-qa-user-name',
  'zhihu-qa-user-headline',
  'zhihu-qa-answer-meta',
  'zhihu-qa-answer-content',
  // 推特卡片（_twitter.scss）
  'tweet',
  'tweet-content',
  'tweet-header',
  'tweet-footer',
  'tweet-media',
  'tweet-user-info',
  // 社媒卡片（_social-post.scss）
  'social-post',
  'social-post-content',
  'social-post-media',
  'social-post-title',
  'social-post-tags',
  'social-post-tag',
  'quote-tweet',
  'quote-tweet-container',
  'quote-header',
  'quote-title',
  'quote-media',
  'quote-link',
  'quote-description',
  'author',
  'name',
  'nickname',
  'desc',
  'description',
  'display',
  'title',
  'text-section',
  'photo-section',
  'profile-image',
  'banner-overlay',
  'additional-info',
  'followers-following',
  // PhotoSwipe 专题（_photo-swipe-topic.scss）
  'topic-container',
  'swiper',
  'swiper-slide'
])

// 前缀放行：CE 组件 / 划线（slax-*）、KaTeX（katex*）、github 语法高亮 token（pl-*）。
const isReservedToken = (token: string): boolean => RESERVED_EXACT.has(token) || token.startsWith('slax') || token.startsWith('katex') || token.startsWith('pl-')

export class ClassIsolationProcessor implements DOMProcessor {
  readonly name = 'ClassIsolationProcessor'

  match(): boolean {
    return true
  }

  process(context: WebProcessorContext): void {
    const root = context.container.querySelector<HTMLElement>(':scope > .html-text')
    if (!root) return

    // getAttribute/setAttribute 兼容 SVG（其 .className 非普通字符串）。
    const elements = Array.from(root.querySelectorAll<HTMLElement>('[class]'))

    for (const el of elements) {
      // KaTeX 子树整体跳过：内部大量裸 class 由 katex.css 驱动，前缀化会破坏渲染。
      if (el.closest('.katex')) continue

      const raw = el.getAttribute('class')
      if (!raw) continue

      const next = raw
        .split(/\s+/)
        .filter(Boolean)
        .map(token => (isReservedToken(token) || token.startsWith(PREFIX) ? token : `${PREFIX}${token}`))
        .join(' ')

      if (next !== raw) {
        el.setAttribute('class', next)
      }
    }
  }

  ssr = {
    registerRewriter(rewriter: SsrRewriter): void {
      let katexDepth = 0
      rewriter.on('*', {
        element(el) {
          const raw = el.getAttribute('class')
          const tokens = raw ? raw.split(/\s+/).filter(Boolean) : []
          const isKatexRoot = tokens.includes('katex')

          // katex 子树整体跳过，维护深度
          if (katexDepth > 0) {
            if (isKatexRoot) {
              katexDepth++
              el.onEndTag(() => {
                katexDepth--
              })
            }
            return
          }

          // katex 根自身也跳过。
          if (isKatexRoot) {
            katexDepth++
            el.onEndTag(() => {
              katexDepth--
            })
            return
          }

          if (!raw) return

          const next = tokens.map(token => (isReservedToken(token) || token.startsWith(PREFIX) ? token : `${PREFIX}${token}`)).join(' ')

          if (next !== raw) {
            el.setAttribute('class', next)
          }
        }
      })
    }
  }
}
