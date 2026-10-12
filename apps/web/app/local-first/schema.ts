/* eslint-disable camelcase */
import { column, Schema, Table } from '@powersync/web'

export const sr_user_bookmark = new Table(
  {
    user_id: column.text,
    is_read: column.integer, // 0/1
    archive_status: column.integer, // 0/1
    is_starred: column.integer, // 0/1
    created_at: column.text,
    updated_at: column.text,
    alias_title: column.text,
    type: column.integer,
    deleted_at: column.text, // null=未删，ISO 字符串=已删
    starred_at: column.text,
    archived_at: column.text,
    metadata: column.text // JSON: { tags: string[], share: {...}|null, bookmark: {...} }
  },
  { trackPrevious: { onlyWhenChanged: true } }
)

export const sr_user = new Table({
  email: column.text,
  name: column.text,
  picture: column.text,
  given_name: column.text,
  family_name: column.text,
  lang: column.text,
  ai_lang: column.text,
  timezone: column.text,
  account: column.text,
  last_read_at: column.text,
  invite_code: column.text
})

// sr_user_tag：用户标签
export const sr_user_tag = new Table(
  {
    user_id: column.text,
    tag_name: column.text,
    display: column.text,
    // "auto" | "mine"：词表所有权，见 sync_rules 的 sr_user_tag 查询
    source: column.text,
    // 用户最近一次手动贴到文章上
    last_used_at: column.text,
    created_at: column.text
  },
  { trackPrevious: true }
)

// sr_bookmark_comment：划线/评论/回复（type: 1=LINE,2=COMMENT,3=REPLY,4=ORIGIN_LINE,5=ORIGIN_COMMENT）
export const sr_bookmark_comment = new Table(
  {
    type: column.integer,
    source: column.text, // JSON: 划线路径
    user_bookmark_uuid: column.text,
    comment: column.text,
    approx_source: column.text,
    content: column.text, // JSON: 选中内容
    is_deleted: column.integer, // 0/1
    created_at: column.text,
    metadata: column.text // JSON: { root_id, parent_id, user_id, ... }
  },
  { trackPrevious: true }
)

export const sr_user_subscription = new Table({
  stripe_subscription_id: column.text,
  stripe_customer_id: column.text,
  stripe_stripe_currency: column.text,
  first_subscription_time: column.text,
  subscription_end_time: column.text,
  next_invoice_time: column.text,
  auto_renew: column.integer,
  stripe_credit: column.integer,
  subscribed: column.integer, // 0/1
  apple_original_transaction_id: column.text,
  source_type: column.text
})

// 我订阅的专栏（订阅关系 + 状态）
export const sr_user_collection_subscriber = new Table({
  collection_id: column.text,
  owner_id: column.text,
  subscription_end_time: column.text,
  next_invoice_time: column.text,
  auto_renew: column.integer,
  last_read_at: column.text,
  created_at: column.text,
  updated_at: column.text,
  is_cancelled: column.integer // 0/1
})

// 专栏信息（名字/头像/简介/开关状态）——关闭(status!=1)后仍保留，供 UI 显示「已关闭」
export const sr_user_collection = new Table({
  owner_id: column.text,
  display_name: column.text,
  avatar: column.text,
  description: column.text,
  collection_code: column.text,
  type: column.integer, // 1=free 2=paid
  status: column.integer, // 1=open 0=closed
  updated_at: column.text
})

// 专栏文章（独立于用户自己的 sr_user_bookmark）；title/url 等在 metadata.bookmark
export const sr_collection_bookmark = new Table({
  owner_id: column.text,
  alias_title: column.text,
  metadata: column.text,
  starred_at: column.text,
  created_at: column.text,
  updated_at: column.text
})

// 文章划线汇总；bookmark_uuid 对应 sr_user_bookmark/sr_collection_bookmark 的 id。
export const sr_user_bookmark_stats = new Table({
  bookmark_uuid: column.text,
  comment_count: column.integer,
  first_comment: column.text,
  owner_id: column.text,
  created_at: column.text
})

export const local_bookmark_info = new Table(
  {
    overview: column.text,
    key_takeaways: column.text, // JSON list
    is_downloaded: column.integer
  },
  { localOnly: true }
)

export const local_reading_state = new Table(
  {
    anchor_index: column.integer,
    anchor_ratio: column.real,
    percent: column.real,
    updated_at: column.text
  },
  { localOnly: true }
)

export const AppSchema = new Schema({
  sr_user,
  sr_user_subscription,
  sr_user_bookmark,
  sr_user_tag,
  sr_bookmark_comment,
  sr_user_collection_subscriber,
  sr_user_collection,
  sr_collection_bookmark,
  sr_user_bookmark_stats,
  local_bookmark_info,
  local_reading_state
})

export type Database = (typeof AppSchema)['types']
