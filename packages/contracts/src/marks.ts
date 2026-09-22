export enum MarkType {
  LINE = 1,
  COMMENT = 2,
  REPLY = 3,
  ORIGIN_LINE = 4,
  ORIGIN_COMMENT = 5
}

export interface MarkPathItem {
  type: 'text' | 'image'
  xpath: string
  start_offet: number
  end_offset: number
}

export interface CreateMarkRequest {
  source: MarkPathItem[]
  select_content: MarkSelectContent[]
  parent_id: number
  parent_uid?: string
  comment?: string
  bm_id?: number
  bookmark_uid?: string
  share_code?: string
  collection_code?: string
  cb_id?: number
  type: MarkType
  approx_source?: MarkApproxSource
}

export interface MarkApproxSource {
  exact: string
  prefix: string
  suffix: string
  position_start: number
  position_end: number
}

export interface MarkSelectContent {
  type: 'text' | 'image'
  text: string
  src: string
}

export interface MarkInfo<Time = string> {
  id: number
  user_id: number
  type: MarkType
  parent_id: number
  root_id: number
  source: MarkPathItem[] | number
  comment: string
  created_at: Time
  is_deleted?: boolean
  approx_source?: Partial<MarkApproxSource> | null
  uuid?: string
  parent_uid?: string
  root_uid?: string
}

export interface MarkUserInfo {
  id: number
  username: string
  avatar: string
}

export interface MarkCommentItem<Time = string> {
  id: number
  type: string
  content: MarkSelectContent[]
  created_at: Time
  title: string
  color?: string
  parent_comment?: string
  parent_comment_deleted?: boolean
  comment: string
  source_type: 'share' | 'bookmark' | 'collection'
  source_id: string
  approx_source?: Partial<MarkApproxSource> | null
  uuid: string
  parent_uid?: string
  root_uid?: string
  bookmark_user_uuid?: string
}

export interface MarkDetail<Time = string> {
  mark_list: MarkInfo<Time>[]
  /** Historical empty/no-access responses use [], populated responses use an ID map. */
  user_list: Record<number, MarkUserInfo> | []
}

export interface CreateMarkResponse {
  mark_id: number
  root_id: number
  mark_uid: string
  root_uid?: string
}

export interface DeleteMarkRequest {
  mark_id?: number
  mark_uid?: string
}
