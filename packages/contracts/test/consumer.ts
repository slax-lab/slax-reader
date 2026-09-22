// Compile with no Node, DOM, Cloudflare or Prisma ambient types.
import { ErrorName, MarkType } from '@slax-reader/contracts'
import type { ApiResponse, ApiKeyListItem, BookmarkTag, CreateMarkRequest, EventsRequest, BookmarkExportResponse } from '@slax-reader/contracts'
import type { MarkInfo, MarkDetail } from '@slax-reader/contracts/marks'
import type { ArchiveBookmarkRequest } from '@slax-reader/contracts/bookmarks'

const key: ApiKeyListItem = { id: 1, name: 'CLI', short_key: 'sr-test', created_at: '2026-09-22T00:00:00.000Z' }
// @ts-expect-error Clients receive JSON strings, not server Date objects.
const invalidDate: ApiKeyListItem = { ...key, created_at: new Date() }
const nullable: BookmarkTag = { id: 1, name: 'reading', show_name: 'reading', last_used_at: null }
const empty: ApiResponse<undefined> = { code: 200, message: 'ok' }
const explicitNull: ApiResponse<null> = { code: 200, message: 'ok', data: null }
// @ts-expect-error Only undefined payloads may omit data.
const missing: ApiResponse<null> = { code: 200, message: 'ok' }
const error: ApiResponse<ErrorName> = { code: 400, message: '', data: ErrorName.ERROR_PARAM }
const exported: BookmarkExportResponse = { items: [], next_cursor: null }
const mark: CreateMarkRequest = {
  source: [{ type: 'text', xpath: '/p', start_offet: 0, end_offset: 4 }],
  select_content: [],
  parent_id: 0,
  bookmark_uid: 'uuid',
  type: MarkType.LINE
}
const archive: ArchiveBookmarkRequest = { bookmark_id: 12345, status: 'archive' }
// @ts-expect-error Legacy HTTP hash IDs remain numeric.
const invalidId: ArchiveBookmarkRequest = { bookmark_id: '12345', status: 'archive' }
const events: EventsRequest = { events: [{ event_name: 'screen_viewed', properties: { nested: [true, null, { screen: 'reader' }] } }] }
// @ts-expect-error Worker bindings are deliberately absent from contracts.
type WorkerEnvironment = Env
// @ts-expect-error Browser globals are not needed to consume contracts.
type BrowserOnly = Window
void [key, invalidDate, nullable, empty, explicitNull, missing, error, exported, mark, archive, invalidId, events]

const parsedMark: MarkInfo = {
  id: 1,
  user_id: 2,
  type: MarkType.LINE,
  parent_id: 0,
  root_id: 1,
  source: [{ type: 'text', xpath: '/p', start_offet: 0, end_offset: 4 }],
  comment: '',
  created_at: '2026-09-22T00:00:00.000Z',
  approx_source: {}
}
// @ts-expect-error Mark source is parsed before it reaches HTTP clients.
const rawMark: MarkInfo = { ...parsedMark, source: '[{}]' }
const hiddenMarks: MarkDetail = { mark_list: [], user_list: [] }
void [parsedMark, rawMark, hiddenMarks]
