import type { MarkPathApprox, MarkPathItem, MarkUserInfo } from '@slax-reader/contracts/interface'
import type { MarkType } from '@slax-reader/contracts/marks'
import type {ReaderInputSnapshot} from './input.ts'

export type HtmlMarkPath = Extract<MarkPathItem, { type: 'text' | 'image' }>
export type ReaderApprox = Partial<MarkPathApprox> & { exact: string }

/** Source output, not the similarly named request type whose offset spelling differs. */
export interface ReaderSelection {
  source: Array<{ type: 'text' | 'image'; xpath: string; start_offset: number; end_offset: number }>
  select_content: Array<{ type: 'text' | 'image'; text: string; src: string }>
  approx_source: MarkPathApprox
  text: string
}

export interface ReaderComment {
  markId: number
  userId: number
  comment: string
  username: string
  avatar: string
  isDeleted: boolean
  createdAt: string
  rootId?: number | null
  children: ReaderComment[]
  reply?: { id: number; username: string; userId: number; avatar: string } | null
}

export interface ReaderMarkItem {
  id: string
  source: HtmlMarkPath[]
  stroke: Array<{ mark_id?: number | null; userId: number }>
  comments: ReaderComment[]
  approx?: ReaderApprox | null
}

/** Date strings are wire-compatible with the source's persisted marks. */
export interface ReaderMarkDetail {
  mark_list: Array<{
    id: number
    uuid?: string
    user_id: number
    type: MarkType
    source: HtmlMarkPath[] | number
    approx_source?: ReaderApprox | null
    parent_id: number
    parent_uid?: string
    root_id: number
    root_uid?: string
    comment: string
    created_at: string | Date
    is_deleted?: boolean
  }>
  user_list: Record<string, MarkUserInfo> | []
}

export interface SelectionGeometry {
  touchClientY: number | null
  top: number | null
  bottom: number | null
}

export type ReaderEvent =
  | { type: 'domReady' }
  | { type: 'requestInfoPack' }
  | { type: 'tap' }
  | { type: 'textSelected'; text: string; mark: ReaderMarkItem; selectionGeometry?: SelectionGeometry; containerYPoints?: number }
  | { type: 'textDeselected' }
  | { type: 'markClicked'; markId: string; text: string; mark: ReaderMarkItem | null }
  | { type: 'markItemInfosChanged'; marks: ReaderMarkItem[] }
  | { type: 'imageClick'; src: string; allImages: string[]; index: number }
  | { type: 'scrollToPosition'; percentage: number }
  | { type: 'scrollToTop' }
  | { type: 'refreshContent' }
  | { type: 'feedback' }
  | { type: 'contentHeight'; height: number }
  | { type: 'documentScroll'; scrollY: number; contentHeight: number; viewportHeight: number }
  | { type: 'selectionError'; error: string }
  | { type: 'inputObservation'; snapshot: ReaderInputSnapshot }
  | { type: 'commandResult'; requestId: string; value?: unknown; error?: string }

export interface ReaderEnvelope { channel: 'slax-reader'; pageId: string; payload: unknown }
export type ReaderFixtureCommand =
  | {kind: 'selection'; source: HtmlMarkPath[]; selectedText?: string}
  | {kind: 'open-comment'; markId: number}
  | {kind: 'open-image'; imageId: string}
  | {kind: 'inspect-selection'}

export type ReaderCommand =
  | { operation: 'initialize'; argument: { currentUserId: number; infoPack?: Record<string, unknown> } }
  | { operation: 'clearSelection' | 'captureSelection' | 'queryYoutubeTime' | 'queryImageUrls' | 'teardown'; argument?: never }
  | { operation: 'drawMarks'; argument: ReaderMarkDetail }
  | { operation: 'scrollToAnchor'; argument: string }
  | { operation: 'scrollTo'; argument: { y: number; animated: boolean } }
  | { operation: 'seekYoutube'; argument: number }
  | { operation: 'prepareFixture'; argument: ReaderFixtureCommand }
