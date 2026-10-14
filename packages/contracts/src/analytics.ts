/**
 * Slax Reader 埋点事件类型定义
 *
 * 数据来源：Slax Reader埋点上报_数据表.csv
 * 命名规范：{feature}_{action} 格式
 * 更新时间：2026-02-06
 */

// ==================== 基础类型定义 ====================

// ==================== 书签相关埋点 ====================

/**
 * 打开书签详情页
 * 上报渠道：Web, Extension
 */
export interface BookmarkViewEvent {
  event: 'bookmark_view'
  id: string // 伪ID，用于统计阅读篇数分布
  mode: 'original' | 'snapshot'
}

/**
 * 归档/取消归档书签
 * 上报渠道：Web, Extension
 */
export interface BookmarkArchiveEvent {
  event: 'bookmark_archive'
  is_archived: boolean
  source: 'bookmark' | 'inbox'
}

/**
 * 加星/取消加星书签
 * 上报渠道：Web, Extension
 */
export interface BookmarkStarEvent {
  event: 'bookmark_star'
  is_starred: boolean
  source: 'bookmark' | 'inbox'
}

/**
 * AI 对话交互
 * 上报渠道：Extension, Web
 */
export interface BookmarkChatInteractEvent {
  event: 'bookmark_chat_interact'
  sub_action: 'open' | 'close' | 'expand' | 'collapse'
  entry_point: 'popup_menu' | 'sidebar_entry'
}

/**
 * Overview交互
 * 上报渠道：Web, Extension
 */
export interface BookmarkOverviewInteractEvent {
  event: 'bookmark_overview_interact'
  sub_action: 'open' | 'close' | 'expand' | 'collapse'
}

/**
 * Outline交互
 * 上报渠道：Web, Extension
 */
export interface BookmarkOutlineInteractEvent {
  event: 'bookmark_outline_interact'
  bookmark_id: number
  sub_action: 'open' | 'close' | 'expand' | 'collapse'
}

/**
 * 删除书签（移动到回收站）
 * 上报渠道：Web
 */
export interface BookmarkDeleteEvent {
  event: 'bookmark_delete'
}

// ==================== 反馈相关埋点 ====================

/**
 * 开始提交反馈
 * 上报渠道：Extension, Web
 */
export interface FeedbackSubmitStartEvent {
  event: 'feedback_submit_start'
  scope: 'bookmark' | 'app'
}

// ==================== 用户相关埋点 ====================

/**
 * 展示登录页面
 * 上报渠道：Web
 */
export interface UserViewLoginEvent {
  event: 'user_view_login'
}

/**
 * 点击登录按钮
 * 上报渠道：Web
 */
export interface UserLoginStartEvent {
  event: 'user_login_start'
  method: 'google' | 'apple'
}

// ==================== 设置相关埋点 ====================

/**
 * 打开设置页面
 * 上报渠道：Web
 */
export interface SettingViewEvent {
  event: 'setting_view'
}

// ==================== 书签列表相关埋点 ====================

/**
 * 打开书签列表页
 * 上报渠道：Web
 */
export interface BookmarkListViewEvent {
  event: 'bookmark_list_view'
  section: 'inbox' | 'starred' | 'topics' | 'collections' | 'highlights' | 'archive' | 'trash' | 'notifications'
}

/**
 * 下载安装插件
 * 上报渠道：Web
 */
export interface BookmarkListDownloadEvent {
  event: 'bookmark_list_download'
  client: 'browser_extension'
}

/**
 * 书签列表项交互
 * 上报渠道：Web
 */
export interface BookmarkListItemInteractEvent {
  event: 'bookmark_list_item_interact'
  bookmark_id: number
  element: 'title' | 'orginal' | 'snapshot' | 'source_filter' | 'edit_title' | 'star' | 'archive' | 'trash'
  section: 'inbox' | 'starred' | 'topics' | 'collections' | 'highlights' | 'archive' | 'trash' | 'notifications'
}

/**
 * 书签列表搜索
 * 上报渠道：Web
 */
export interface BookmarkListSearchEvent {
  event: 'bookmark_list_search'
}

// ==================== 官网相关埋点 ====================

/**
 * 访问官网页面
 * 上报渠道：Web
 */
export interface HomepageViewEvent {
  event: 'homepage_view'
  section: 'homepage' | 'pricing' | 'download' | 'blog' | 'contact'
}

/**
 * 官网下载
 * 上报渠道：Web
 */
export interface HomepageDownloadEvent {
  event: 'homepage_download'
  client: 'ios' | 'android' | 'mac' | 'browser_extension'
}

/**
 * 领取免费试用
 * 上报渠道：Web
 */
export interface HomepageClaimFreeTrialEvent {
  event: 'homepage_claim_free_trial'
  source: 'official' | 'koc'
  referral_code?: string
}

/**
 * 打开订阅入口
 * 上报渠道：Web
 */
export interface SubscriptionViewEvent {
  event: 'subscription_view'
  presentation: 'dialog' | 'screen'
}

// ==================== 联合类型 ====================

/**
 * 所有埋点事件的联合类型
 */
export type AnalyticsEvent =
  // 书签相关
  | BookmarkViewEvent
  | BookmarkArchiveEvent
  | BookmarkStarEvent
  | BookmarkChatInteractEvent
  | BookmarkOverviewInteractEvent
  | BookmarkOutlineInteractEvent
  | BookmarkDeleteEvent
  // 反馈相关
  | FeedbackSubmitStartEvent
  // 用户相关
  | UserViewLoginEvent
  | UserLoginStartEvent
  // 设置相关
  | SettingViewEvent
  // 书签列表相关
  | BookmarkListViewEvent
  | BookmarkListDownloadEvent
  | BookmarkListItemInteractEvent
  | BookmarkListSearchEvent
  // 官网相关
  | HomepageViewEvent
  | HomepageDownloadEvent
  | HomepageClaimFreeTrialEvent
  | SubscriptionViewEvent

/**
 * Web 端埋点事件类型
 */
export interface BookmarkExportEvent {
  event: 'bookmark_export_start' | 'bookmark_export_complete' | 'bookmark_export_failure' | 'bookmark_export_cancel'
  format: 'csv' | 'json'
  item_count: number
  duration_ms: number
}

export type WebAnalyticsEvent =
  | BookmarkExportEvent
  | BookmarkViewEvent
  | BookmarkArchiveEvent
  | BookmarkStarEvent
  | BookmarkChatInteractEvent
  | BookmarkOverviewInteractEvent
  | BookmarkOutlineInteractEvent
  | BookmarkDeleteEvent
  | FeedbackSubmitStartEvent
  | UserViewLoginEvent
  | UserLoginStartEvent
  | SettingViewEvent
  | BookmarkListViewEvent
  | BookmarkListDownloadEvent
  | BookmarkListItemInteractEvent
  | BookmarkListSearchEvent
  | HomepageViewEvent
  | HomepageDownloadEvent
  | HomepageClaimFreeTrialEvent
  | SubscriptionViewEvent

/**
 * Extension 端埋点事件类型
 */
export type ExtensionAnalyticsEvent =
  BookmarkArchiveEvent | BookmarkStarEvent | BookmarkChatInteractEvent | BookmarkOverviewInteractEvent | BookmarkOutlineInteractEvent | FeedbackSubmitStartEvent | BookmarkViewEvent

/** Dashboard and heartbeat actions shared by Web and Extension. */
export type MetricActionType = 'heartbeat' | 'ai_overview' | 'ai_summary'

// ==================== 工具类型 ====================

/**
 * 提取事件名称类型
 */
export type AnalyticsEventName = AnalyticsEvent['event']

/**
 * 根据事件名称提取参数类型
 */
export type AnalyticsEventParams<T extends AnalyticsEventName> = Extract<AnalyticsEvent, { event: T }>

/**
 * 埋点上报函数类型
 */
export type AnalyticsTrackFn = <T extends AnalyticsEventName>(params: AnalyticsEventParams<T>) => void
