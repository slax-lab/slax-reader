export type UserTagSource = 'auto' | 'mine'
export type BookmarkTagSource = 'user' | 'ai' | ''

export interface BookmarkTag<Time = string> {
  id: number
  name: string
  show_name: string
  display?: boolean
  /** vocabulary ownership: "mine" = confirmed by the user, "auto" = never confirmed */
  source?: UserTagSource
  last_used_at?: Time | null
  /** on a bookmark: who attached it. "" for history */
  added_by?: BookmarkTagSource
  /** only on the "+" picker of the multi-tag filter page */
  count?: number
}

/** A tag addressed by numeric HTTP hashid or sync UUID. */
export interface TagRef {
  tag_id?: number
  tag_uuid?: string
}

export interface ListTagsQuery {
  within?: string
}
export interface CreateTagRequest {
  tag_name: string
}
export interface UpdateTagRequest extends TagRef {
  tag_name: string
}
export interface PromoteTagRequest extends TagRef {
  tag_name?: string
}
