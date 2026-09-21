/**
 * Selection模块的类型定义
 *
 * 统一了dweb和extensions两端的类型系统
 */

import type { MarkPathApprox, MarkPathItem, MarkSelectContent } from '@commons/types/interface'

// 重新导出以供外部使用
export type { MarkPathItem, MarkSelectContent, MarkPathApprox }

/**
 * 菜单类型枚举
 */
export enum MenuType {
  /** 复制 */
  Copy = 'copy',
  /** 划线 */
  Stroke = 'stroke',
  /** 删除划线 */
  Stroke_Delete = 'stroke_delete',
  /** 评论 */
  Comment = 'comment',
  /** AI对话 */
  Chatbot = 'chatbot'
}

/**
 * 划线标记项信息
 */
export interface MarkItemInfo {
  /** 标记ID */
  id: string
  /** 标记路径源 */
  source: MarkPathItem[]
  /** 划线信息列表 */
  stroke: { mark_uid?: string; userId: number; createdAt?: Date }[]
  /** 评论信息列表 */
  comments: MarkCommentInfo[]
  /** 近似匹配信息（用于兼容旧版本划线） */
  approx?: MarkPathApprox
}

/**
 * 标记评论信息
 */
export type MarkCommentInfo = {
  /** 评论UUID */
  markUid: string
  /** 评论内容 */
  comment: string
  /** 用户ID */
  userId: number
  /** 用户名 */
  username: string
  /** 用户头像 */
  avatar: string
  /** 是否已删除 */
  isDeleted: boolean
  /** 回复信息 */
  reply?: {
    username: string
    userId: number
    uid: string
    avatar: string
  }
  /** 根评论UUID */
  rootUid?: string
  /** 创建时间 */
  createdAt: Date
  /** 子评论列表 */
  children: MarkCommentInfo[]
} & {
  // UI相关的控制属性
  /** 是否显示输入框 */
  showInput: boolean
  /** 加载状态 */
  loading: boolean
  /** 操作加载状态 */
  operateLoading: boolean
  /** 是否找不到对应的划线映射 */
  noMarkMapping?: boolean
}

/**
 * 引用数据类型（用于Chat功能）
 */
export type QuoteData = {
  source: {
    id?: string
    selection?: Range
    paths?: MarkPathItem[]
  }
  data: { type: 'image' | 'text'; content: string }[]
}

/**
 * Selection配置接口
 *
 * 注意：不同环境的差异通过适配器接口处理：
 * - dweb: 通过iframe、bookmarkId、shareCode等配置
 * - extensions: 通过userInfo、bookmarkIdQuery等配置
 */
export interface SelectionConfig {
  /** 容器DOM */
  containerDom: HTMLDivElement | null
  /** 监听DOM */
  monitorDom: HTMLDivElement | null
  /** 是否允许操作 */
  allowAction: boolean
  /** chat 入口开关，默认开 */
  allowChatbot?: boolean
  /** 引用数据处理器 */
  postQuoteDataHandler: (data: QuoteData) => void

  // 以下字段将由适配器提供，此处仅用于类型兼容
  /** 书签ID（dweb直接提供） */
  bookmarkId?: number
  /** 分享码（dweb提供） */
  shareCode?: string
  /** 收藏信息（dweb提供） */
  collection?: { code: string; cb_id: number }
  /** 所有者用户ID（dweb提供） */
  ownerUserId?: number
  /** iframe元素（dweb支持） */
  iframe?: HTMLIFrameElement
  /** 标记评论选择处理器 */
  markCommentSelectHandler?: (comment: MarkCommentInfo) => void
  /** 菜单评论处理器 */
  menusCommentHandler?: (info: MarkItemInfo, data: QuoteData['data']) => void
  /** 行末评论 icon 开关，默认关 */
  commentTailIndicator?: boolean
}

/**
 * 划线选择元数据
 */
export interface StrokeSelectionMeta {
  /** 标记信息 */
  info: MarkItemInfo
  /** 评论内容 */
  comment?: string
  /** 回复目标ID */
  replyToUid?: string
}

/**
 * 绘制标记的基础信息
 */
export interface DrawMarkBaseInfo {
  /** 标记ID */
  id: string
  /** 是否为划线 */
  isStroke: boolean
  /** 是否有评论 */
  isComment: boolean
  /** 是否为自己的划线 */
  isSelfStroke: boolean
  /** 是否高亮显示 */
  isHighlighted?: boolean
}

/**
 * 选择的文本信息
 */
export type SelectTextInfo =
  | {
      type: 'text'
      /** 起始偏移 */
      startOffset: number
      /** 结束偏移 */
      endOffset: number
      /** 文本内容 */
      text: string
      /** 文本节点 */
      node?: Node
    }
  | {
      type: 'image'
      /** 图片源 */
      src: string
      /** 图片元素 */
      ele: Element
    }

/**
 * 标记类型枚举
 */
export enum MarkType {
  /** 划线 */
  Stroke = 'stroke',
  /** 评论 */
  Comment = 'comment'
}
