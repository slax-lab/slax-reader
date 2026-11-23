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

  const writes = (added: string[] = [], deleted: string[] = []) => ({ added: new Set(added), deleted: new Set(deleted) })

  it('keeps REST marks while a mark written over REST is missing locally', () => {
    expect(localMarksCoverShown(detail(), detail(), writes(['new']))).toBe(false)
    expect(localMarksCoverShown(detail(mark('a')), detail(mark('a')), writes(['new']))).toBe(false)
  })

  it('hands over once local rows include the mark written over REST', () => {
    expect(localMarksCoverShown(detail(), detail(mark('new')), writes(['new']))).toBe(true)
  })

  it('keeps REST marks while a mark written over REST is still deleted locally', () => {
    expect(localMarksCoverShown(detail(), detail(mark('new', { is_deleted: true })), writes(['new']))).toBe(false)
  })

  it('keeps REST marks while a mark deleted over REST is still live locally', () => {
    expect(localMarksCoverShown(detail(mark('a')), detail(mark('a')), writes([], ['a']))).toBe(false)
  })

  it('hands over once local rows drop or delete the mark deleted over REST', () => {
    expect(localMarksCoverShown(detail(mark('a')), detail(), writes([], ['a']))).toBe(true)
    expect(localMarksCoverShown(detail(mark('a', { comment: 'x' })), detail(mark('a', { is_deleted: true })), writes([], ['a']))).toBe(true)
  })

  it('treats a mark added then deleted over REST as gone', () => {
    expect(localMarksCoverShown(detail(), detail(), writes(['new'], ['new']))).toBe(true)
  })
})
