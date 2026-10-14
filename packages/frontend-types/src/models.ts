// Load compatibility augmentations before deriving models from the legacy
// interface module. The augmentation module has no runtime exports.
import '@slax-reader/contracts/augmentations'
import type * as Legacy from '@slax-reader/contracts/interface'
import type { SelectionMarkPathApprox, SelectionMarkPathItem } from './selection'

/** Browser tree model; API mark responses do not require a children array. */
export interface MarkInfo extends Omit<Legacy.MarkInfo, 'source' | 'approx_source'> {
  source: SelectionMarkPathItem[]
  approx_source?: SelectionMarkPathApprox
  children: MarkInfo[]
}

export interface MarkDetail extends Omit<Legacy.MarkDetail, 'mark_list'> {
  mark_list: MarkInfo[]
}

/** REST tags enriched with local identity and synchronized visibility state. */
export interface BookmarkTag extends Legacy.BookmarkTag {
  // Retains the legacy ID typing until the local-first identity adapter is migrated.
  id_kind?: 'hashid' | 'uuid'
  display?: boolean
}

export interface BookmarkItem extends Legacy.BookmarkItem {
  tags?: BookmarkTag[]
  /** UUIDs from the local-first bookmark metadata, resolved through the local tag vocabulary. */
  tag_ids?: string[]
}

export interface BaseBookmarkDetail extends Omit<Legacy.BaseBookmarkDetail, 'marks' | 'tags'> {
  marks: MarkDetail
  tags: BookmarkTag[]
}

export interface BookmarkBriefDetail extends Omit<Legacy.BookmarkBriefDetail, 'marks' | 'tags'> {
  marks: MarkDetail
  tags: BookmarkTag[]
}

export interface InlineBookmarkDetail extends Omit<Legacy.InlineBookmarkDetail, 'marks'> {
  marks: MarkDetail
}

export interface BookmarkDetail extends Omit<Legacy.BookmarkDetail, 'marks' | 'tags'>, BaseBookmarkDetail {}
export interface ShareBookmarkDetail extends Omit<Legacy.ShareBookmarkDetail, 'marks' | 'tags'> {
  marks: MarkDetail
  tags: BookmarkTag[]
}
export interface CollectionBookmarkDetail extends Omit<Legacy.CollectionBookmarkDetail, 'marks' | 'tags'>, BaseBookmarkDetail {}
export interface SnapshotBookmarkDetail extends Omit<Legacy.SnapshotBookmarkDetail, 'marks' | 'tags'> {
  marks: MarkDetail
  tags: BookmarkTag[]
}

export type SnapshotMetadata = Omit<SnapshotBookmarkDetail, 'content' | 'marks'> & {
  content_key?: string | null
  [key: string]: unknown
}
