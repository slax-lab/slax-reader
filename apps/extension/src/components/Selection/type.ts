import type { QuoteData } from '../Chat/type'
import type { MarkPathApprox, MarkPathItem, UserInfo } from '@commons/types/interface'

export enum MenuType {
  Copy = 'copy',
  Stroke = 'stroke',
  Stroke_Delete = 'stroke_delete',
  Comment = 'comment',
  Chatbot = 'chatbot'
}

export interface MarkItemInfo {
  id: string
  source: MarkPathItem[]
  stroke: { mark_uid?: string; userId: number }[]
  comments: MarkCommentInfo[]
  approx: MarkPathApprox
}

export type MarkCommentInfo = {
  markUid: string
  comment: string
  userId: number
  username: string
  avatar: string
  isDeleted: boolean
  reply?: {
    username: string
    userId: number
    uid: string
    avatar: string
  }
  rootUid?: string
  createdAt: Date
  children: MarkCommentInfo[]
} & {
  // 针对界面相关的控制属性
  showInput: boolean
  loading: boolean
  operateLoading: boolean
  noMarkMapping?: boolean // # 是否找不到对应的划线映射
}

export interface SelectionConfig {
  containerDom: HTMLDivElement | null
  monitorDom: HTMLDivElement | null
  allowAction: boolean
  userInfo: UserInfo | null
  bookmarkIdQuery: () => Promise<number>
  postQuoteDataHandler: (data: QuoteData) => void
  markCommentSelectHandler?: (comment: MarkCommentInfo) => void
  menusCommentHandler?: (info: MarkItemInfo, data: QuoteData['data']) => void
  /** 行末评论 icon 开关，默认关 */
  commentTailIndicator?: boolean
}

export interface StrokeSelectionMeta {
  info: MarkItemInfo
  comment?: string
  replyToUid?: string
}

export interface DrawMarkBaseInfo {
  id: string
  isStroke: boolean
  isComment: boolean
  isSelfStroke: boolean
  isHighlighted?: boolean
}

export type SelectTextInfo =
  | {
      type: 'text'
      startOffset: number
      endOffset: number
      text: string
      node?: Node
    }
  | {
      type: 'image'
      src: string
      ele: Element
    }
