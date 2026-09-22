// Augments `@commons/types/interface` with the fields and interfaces that are
// shared by the current Web and Extension applications.
//
// Importing `@commons/types` once anywhere in the program (e.g. via
// the app's `index.d.ts`) makes every `from '@commons/types/interface'`
// import see the augmented and added types.

import type { BookmarkParseStatus, CollectionInfo, SubscriptionType } from '@commons/types/interface'

// Keep these imported names visible to package-level noUnusedLocals checks;
// they are consumed inside the module augmentation below.
export type { BookmarkParseStatus, CollectionInfo, SubscriptionType }

declare module '@commons/types/interface' {
  // ─── Field augmentations on upstream interfaces ─────────────────────

  interface BookmarkDetail {
    type: 'shortcut' | 'article'
  }

  // 加星/归档时间戳（local-first 列表按此排序/分组，均可选）
  interface BookmarkItem {
    starred_at?: string | null
    archived_at?: string | null
  }

  // 星标合集管理页（报告 03）· 前端先行阶段全部可选，后端补齐后转必填
  interface UserShareCollectInfo {
    // 合集描述（管理页可编辑；后端 description 缺口，DB 迁移后补齐）
    description?: string
    // 概况：内容数（当前星标数，含快捷方式）
    starred_count?: number
    // 概况：订阅者数（active count）
    subscriber_count?: number
  }

  interface UserEnableCollectShare {
    description?: string
  }

  interface UserInfo {
    subscription_type: SubscriptionType
    subscription_end_at: Date
  }

  // ─── Additional shared exports ─────────────────────────────────────

  export interface CollectionBookmarkDetail extends BaseBookmarkDetail {
    bookmark_id?: number
    // 归属者 uuid，供 /c 跳 /b
    bookmark_uuid?: string
    alias_title: string
    private_user?: number
    status: BookmarkParseStatus
    updated_at?: string
    type: 'shortcut' | 'article'
    collection_info: CollectionInfo
    user_info: BookmarkOwnerInfo
  }

  export interface SnapshotUserInfo {
    show_userinfo?: boolean
    nick_name?: string
    avatar?: string
  }

  // /b/[id] 快照页详情，无 bookmark_id，走只读分支
  export interface SnapshotBookmarkDetail extends BaseBookmarkDetail {
    uuid: string
    bookmark_uuid: string
    site_name: string
    alias_title: string
    status: BookmarkParseStatus
    updated_at?: string
    user_id: number
    role: string
    archived: 'inbox' | 'archive' | 'later'
    starred: 'star' | 'unstar'
    trashed_at: string | null
    type: 'shortcut' | 'article'
    first_comment?: string
    outline?: string
    user_info?: SnapshotUserInfo
    // 合集来源互动权限，content/meta 暂未下发
    collection_info?: CollectionInfo
    // 所属开启中合集，用于 footer
    collection?: SnapshotCollectionRef | null
  }

  // 快照页 footer 的合集归属引用
  export interface SnapshotCollectionRef {
    name: string
    // collection_code，前端拼 /c/[code]
    code: string
  }

  // content 走 body、marks 另取，故排除
  export type SnapshotMetadata = Omit<SnapshotBookmarkDetail, 'content' | 'marks'> & {
    content_key?: string | null
    [key: string]: unknown
  }

  // Dashboard metrics

  export interface DashboardMetricsQuery {
    start_time: string
    end_time: string
  }

  export interface OverallMetrics {
    active_users: number
    new_bookmarks: number
    bookmark_users: number
    new_subscriptions: number
    archive_users: number
    activated_users: number
    ai_power_users: number
    overview_users: number
    summary_users: number
  }

  export interface DashboardMetricsDailyItem {
    day: string
    new_users_ios: number
    new_users_android: number
    new_users_web: number
    new_users_extension?: number
    active_users: number
    active_users_ios: number
    active_users_android: number
    active_users_web: number
    active_users_extension: number
    new_bookmarks: number
    bookmark_users: number
    new_subscriptions: number
    new_subscriptions_stripe?: number
    new_subscriptions_apple_iap?: number
    new_subscriptions_trial?: number
    new_subscriptions_blogger_trial?: number
    subscription_failed?: number
    archive_users: number
    activated_users: number
    ai_power_users: number
    overview_users?: number
    summary_users?: number
  }

  export interface DashboardMetricsDailyResponse {
    data: DashboardMetricsDailyItem[]
  }

  export interface PlatformMetric {
    platform: string | null
    new_users: number
    active_users: number
  }

  // 访问总人数/人次(visit 事件)
  export interface VisitOverview {
    total_visits: number // 访问人次
    unique_visitors: number // 去重访问人数
    guest_visitors: number // 去重游客数(user_id=0)
    member_visitors: number // 去重登录用户数(user_id>0)
  }

  // 访问最多的文章(去重)。访客=游客(未登录, user_id=0)，用户=登录会员(user_id>0)，两组互斥
  export interface TopArticleItem {
    uuid: string
    title: string
    link: string // 相对路径 /b/:uuid
    guest_uv: number // 访客人数(游客去重)
    guest_visits: number // 访客次数(游客人次)
    member_uv: number // 用户人数(登录用户去重)
    member_visits: number // 用户次数(登录用户人次)
  }

  // 新增书签里每个 step 的成功率(bookmark_add_step 事件)
  export interface BookmarkStepStat {
    step_name: string
    bookmarks: number // 进入该step的去重书签数
    attempts: number // 执行次数(含重试)
    success: number // 成功次数
    failed: number // 失败次数
    success_rate: number // 成功率(百分比)
    group?: 'funnel' | 'metadata' // 漏斗层 / metadata 层
    order?: number // 漏斗内排序
  }

  // 新增书签漏斗：入口(bookmark_add) + crawl 阶段(funnel，按序递减) + metadata 层(单列)
  export interface BookmarkAddEntry {
    step_name: string // 'bookmark_add'
    attempts: number // 发起次数
    bookmarks: number // 去重书签数（旧数据可能为 0）
    users: number // 去重用户数
    success: number // 成功发起次数
    failed: number // 失败发起次数
  }

  export interface BookmarkFunnel {
    entry: BookmarkAddEntry
    funnel: BookmarkStepStat[]
    metadata: BookmarkStepStat[]
  }

  export interface BloggerInfo {
    name: string
    avatar: string
    activity_id: string
    activity_type: string
  }

  // User API keys

  export interface UserApiKey {
    id: number
    name: string
    key?: string | null
    short_key?: string | null
    expires_at: string | null
    created_at: string
  }

  export interface UserApiKeyCreated {
    id: number
    name: string
    key: string
    created_at: string
  }

  // Share collect (paid)

  // 契约对齐后端 shareCollectionItem（domain/collection.ts）；后端可空字段回空串/0
  export interface UserShareCollectListItem {
    title: string
    // 标题规则同 /bookmarks inbox：truncateTitle(alias_title || title, 48) || target_url
    alias_title?: string
    target_url?: string
    // 卡片直跳 /b/{bookmark_uuid}
    bookmark_uuid?: string
    site_name?: string
    // 全部非回复 mark 数（后端 stats 表 comment_count）
    mark_count?: number
    // 星标时间；展示/分组统一按 starred_at
    starred_at?: string
    created_at?: string
    // hashids 编码 id（后端 encodeId 返回 number）
    cb_id?: number
    // 首条 mark 原始数据，展示交前端判断
    first_mark?: { content: string; comment: string; source: string } | null
  }

  export interface UserShareCollectInfoResp {
    collection_name: string
    publisher_name: string
    publisher_avatar: string
    subscrition_count: number
    list: UserShareCollectListItem[]
    // ─── 后端保证下发（userShareCollectInfo）───
    // 合集描述（Hero 展示 + 管理页编辑）
    description: string
    // 内容数（全量星标数），Hero 统计块 + 分页
    bookmark_count: number
    // 当前登录用户是否 owner（服务端返回，规避水合闪烁）
    is_owner: boolean
    // 关闭态：0=已关闭，1=开启中/公开中
    status: number
    // ─── 付费→免费：付费字段降级为可选（重构清理消费点后移除）───
    collection_price?: number
    subscrition_end_time?: string
    // SEO lastmod / OG「最近更新于」；后端暂未下发，缺省回退
    updated_at?: string
  }

  // owner_info：主人名+头像
  export interface CollectionOwnerInfo {
    code: string
    nick_name: string
    avatar: string
  }

  // In-app purchase

  export interface InAppPurchaseStatus {
    product: {
      apple_product_id: string
      apple_promotional_offer_id: string
      early_renewal_title: string
      early_renewal_tip: string
      trial_months: number
      button_text: string
      button_tip_text: string
      pay_price: string
      pay_interval: 'Month'
      origin_price: string
      feature_supplement: string
      feature: string[]
      highlight: number[]
    }
    subscription: {
      type: 'none' | 'system' | 'stripe' | 'apple' | 'google'
      end_time: string
      auto_renew: boolean
      stripe_home?: string
    }
  }

  export interface InAppPurchaseOrderIdData {
    uuid: string
    promotional_signature: {
      signature: string
      nonce: string
      timestamp: number
      key_identifier: string
    }
  }
}
