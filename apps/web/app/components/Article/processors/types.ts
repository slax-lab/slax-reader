export enum ArticleStyle {
  Default = 'default',
  Twitter = 'twitter',
  // 非 Twitter 社媒卡片（小红书/微博/Reddit）
  SocialPost = 'social-post',
  PhotoSwipeTopic = 'photo-swipe-topic'
}

export interface ImagePreviewOptions {
  url: string
  frame: {
    left: number
    top: number
    width: number
    height: number
    imgWidth: number
    imgHeight: number
  }
  dismissHandler: () => void
}

export interface WebProcessorContext {
  container: HTMLElement
  url: URL
  articleStyle: ArticleStyle
  callbacks: {
    screenLockUpdate: (locked: boolean) => void
    showImagePreview: (options: ImagePreviewOptions) => void
    websiteClick: () => void
  }
  cleanups: (() => void)[]
}

// SSR 窄类型：只声明用到的子集

// el 调用结束即失效，插入须用 endTag token
export interface SsrEndTag {
  before(content: string, contentOptions?: { html?: boolean }): void
  after(content: string, contentOptions?: { html?: boolean }): void
  remove(): void
}

export interface SsrElement {
  readonly tagName: string
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  onEndTag(handler: (endTag: SsrEndTag) => void): void
}

// text 流式分片，末片 lastInTextNode 为 true
export interface SsrTextChunk {
  readonly text: string
  readonly lastInTextNode: boolean
}

export interface SsrElementHandlers {
  element(element: SsrElement): void
  text?(chunk: SsrTextChunk): void
}

export interface SsrRewriter {
  on(selector: string, handlers: SsrElementHandlers): SsrRewriter
}

// SSR 改写上下文，字段可选
export interface SsrRewriteContext {
  url?: URL
  articleStyle?: ArticleStyle
}

export interface DOMProcessor {
  readonly name: string
  match(context: WebProcessorContext): boolean
  process(context: WebProcessorContext): void | Promise<void>
  // 可选：实现即视为 SSR 可用
  ssr?: {
    registerRewriter(rewriter: SsrRewriter): void
  }
}
