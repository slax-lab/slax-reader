import type {RefObject} from 'react'
import type {RssEntryDetail} from '@slax-reader/contracts'
import type {PdfDescriptor} from '@slax-reader/contracts/pdf'
import type {BookmarkRecord, MarkCommentProfile, PreferenceValues} from '../../data'
import type {MobileScreenProps} from '../../navigation/types'
import type {useMobile} from '../../runtime'
import type {useTelemetry} from '../../telemetry'
import type {ReaderHandle} from '../ReaderWebView'

export type MobileContext = ReturnType<typeof useMobile>
export type Translate = MobileContext['t']
export type ReaderIdentity = MobileScreenProps<'Reader'>['route']['params'] & {
  cacheKey: string
  currentUserId: string
  isCollection: boolean
  isPreview: boolean
}
export interface ReaderLifetime {
  mounted: RefObject<boolean>
  foreground: RefObject<boolean>
  appActive: boolean
  routeVisible?: boolean
  transitionReady?: boolean
  isAccountActive(): boolean
}
export interface ReaderScope extends ReaderIdentity, ReaderLifetime {
  reader: RefObject<ReaderHandle | null>
  t: Translate
  fail(reason: unknown): void
}
export type ReaderTelemetry = ReturnType<typeof useTelemetry>
export type ReaderLocalSnapshot = {revision: number; values: Record<string, unknown>}
export type ReaderOverlay = 'toolbar' | 'overview' | 'tags' | 'edit' | 'delete' | 'subscription' | null
export interface ReaderDocumentTransitions {
  acceptRecord(record: BookmarkRecord): void
  hydrateProfiles(profiles: MarkCommentProfile[]): void
  hydrateAi(snapshot: ReaderLocalSnapshot): void
  documentChanged(): void
  revokeAccess(): void
  clearSelection(): void
}
export interface ReaderPresentationIdentity {
  title: string
  originalUrl: string
  isPdf: boolean
  pdf: PdfDescriptor | null
  rss: RssEntryDetail | null
}
export type WriteReaderPreferences = (edit: (values: PreferenceValues) => void) => Promise<unknown>
