import type { QuoteData } from '@slax-reader/selection/types'

// 每一个消息的基本结构
export interface MessageBaseItem {
  type: string
  id: string
}

// 对话的气泡内容消息结构
export type BubbleMessageContent =
  | { type: 'text'; content: string; isHTML?: boolean; rawContent?: string; sessionId: number }
  | { type: 'links'; content: { url: string; title: string; content: string; icon: string }[]; sessionId: number }
  | { type: 'bookmarks'; content: { title: string; content: string; bookmark_id: number }[]; sessionId: number }
  | { type: 'tips'; tips: string; tipsType: 'generateQuestion' | 'search' | 'browser' | 'searchBookmark' | 'error'; loading?: boolean; sessionId: number }
  | { type: 'related-question'; questions: { content: string; rawContent?: string }[]; sessionId: number }

// 对话的气泡消息结构
export interface BubbleMessageItem extends MessageBaseItem {
  type: 'bubble'
  direction: 'left' | 'right'
  contents?: BubbleMessageContent[]
  quote?: QuoteData
  isBuffering?: boolean
  sessionId: number
}

// 对话的问题消息结构
export interface QuestionMessageItem extends MessageBaseItem {
  type: 'question'
  text: string
  clickable: boolean
  isHTML?: boolean
  rawContent?: string
}

// 提示类消息结构
export interface TipsMessageItem extends MessageBaseItem {
  type: 'tips'
  tipsType: 'text' | 'generateQuestion' | 'error'
  data?: string | Record<string, string | number>
}

// 对话的消息结构类型
export type MessageItem = BubbleMessageItem | QuestionMessageItem | TipsMessageItem

// 重新导出 QuoteData 以便其他地方使用
export type { QuoteData }
