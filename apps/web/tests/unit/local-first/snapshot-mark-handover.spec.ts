import type { MarkDetail, MarkInfo } from '@commons/frontend-types/models'
import { localMarksCoverShown } from '~/local-first/snapshot-mark-handover'
import { describe, expect, it } from 'vitest'

const mark = (uuid: string, extra: Partial<MarkInfo> = {}) => ({ id: 1, uuid, user_id: 1, type: 1, source: [], parent_id: 0, parent_uid: '', root_id: 0, root_uid: '', comment: '', created_at: new Date(0), is_deleted: false, children: [], ...extra }) as unknown as MarkInfo
const detail = (...marks: MarkInfo[]): MarkDetail => ({ mark_list: marks, user_list: {} })

describe('snapshot mark handover from REST to local', () => {
  it('hands over when local rows contain every shown mark', () => {
    expect(localMarksCoverShown(detail(mark('a'), mark('b')), detail(mark('b'), mark('a')))).toBe(true)
  })

  it('hands over when local rows add marks the REST response did not have', () => {
    expect(localMarksCoverShown(detail(mark('a')), detail(mark('a'), mark('new')))).toBe(true)
  })

  it('hands over from an empty REST response', () => {
    expect(localMarksCoverShown(detail(), detail(mark('a')))).toBe(true)
  })

  it('keeps the shown marks while local rows lack one of them', () => {
    expect(localMarksCoverShown(detail(mark('a'), mark('b')), detail(mark('a')))).toBe(false)
  })

  it('keeps the shown marks while a shown comment differs locally', () => {
    expect(localMarksCoverShown(detail(mark('a', { comment: 'new text' })), detail(mark('a', { comment: 'old text' })))).toBe(false)
  })

  it('keeps the shown marks while deletion state differs', () => {
    expect(localMarksCoverShown(detail(mark('a')), detail(mark('a', { is_deleted: true })))).toBe(false)
  })

  it('ignores a shown mark that is already deleted and absent locally', () => {
    expect(localMarksCoverShown(detail(mark('a', { is_deleted: true })), detail())).toBe(true)
  })
})
