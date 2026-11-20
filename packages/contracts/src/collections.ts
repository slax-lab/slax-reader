export interface ShareCollectionInfo {
  collection_name: string
  publisher_name: string
  publisher_avatar: string
  subscrition_count: number
  subscrition_end_time: string
  list: ShareCollectionItem[]
  description: string
  is_owner: boolean
  status: number
  bookmark_count: number
}

export interface ShareCollectionItem {
  title: string
  alias_title: string
  target_url: string
  cb_id: number
  bookmark_uuid: string
  site_name: string
  mark_count: number
  starred_at: string
  created_at: string
  // 首条 mark 原始数据
  first_mark: { content: string; comment: string; source: string } | null
}

export interface ShareCollectionSubscription {
  type: string
  cancelled: boolean
  id: number
  code: string
  subscription_end_time: string
  subscribed_at: string
  last_read_at: string
  display_name: string
  description: string
  status: number
  updated_at: string
  avatar: string
}

export interface UpdateShareCollectionRequest {
  name: string
  show_marks: boolean
  allow_marks: boolean
  show_profile: boolean
  avatar?: string
  description?: string
}

export interface ShareCollectionSubscribeResponse {
  subscribe: boolean
}

export interface MyShareCollectionInfo {
  show_name: string
  avatar: string
  description: string
  starred_count: number
  subscriber_count: number
  collection_code: string
  status: number
  show_marks: boolean
  allow_marks: boolean
  show_profile: boolean
}

export interface CollectionCodeRequest {
  collect_code: string
}
export interface SubscribeCollectionRequest extends CollectionCodeRequest {
  referrer?: string
}

export const DISCOVERY_MEDIA_TYPE = 'application/vnd.slax.discovery+json'

export interface RecommendedCollection {
  code: string
  name: string
  description: string
  /** Backend display order. The first article leads the card. */
  articles: Array<{
    bookmarkUuid: string
    title: string
    url: string
    selectionReason?: 'saved_interest' | 'interest' | 'recent'
    siteName?: string
    description?: string
  }>
}

export interface CollectionRecommendations {
  impressionId: string
  algorithm: string
  preferenceKind: 'collection'
  reason?: 'cold_start' | 'no_public_candidates'
  /** Discover orders multi-story cards first, followed by unique single-story picks. */
  items: RecommendedCollection[]
}
