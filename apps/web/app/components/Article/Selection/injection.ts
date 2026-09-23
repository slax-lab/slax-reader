import type { IHttpClient } from '@slax-reader/selection/adapters'
import type { InjectionKey, MaybeRefOrGetter } from 'vue'

/**
 * BookmarkArticle 行为注入契约
 * 默认空=现状，仅 fork LF 覆写
 */
export interface ArticleSelectionAdapters {
  /** 覆盖 HttpClient，仅客户端 */
  httpClient?: () => IHttpClient
  /** 强制放开权限 */
  allowActionOverride?: boolean
  /** chat 入口开关，默认开 */
  allowChatbot?: boolean
  /** 覆盖 ownerUserId，初始化生效 */
  ownerUserId?: MaybeRefOrGetter<number | undefined>
  /** marks 来源：detail | props */
  markSource?: 'detail' | 'props'
  /** 本地标签库 uuid，仅 LF 下发 */
  tagsBookmarkUuid?: string
  /** 行末评论 icon 开关，仅快照页注入 */
  commentTailIndicator?: boolean
}

// Symbol key，避免撞名
export const ArticleSelectionAdaptersKey: InjectionKey<ArticleSelectionAdapters> = Symbol('ArticleSelectionAdapters')
