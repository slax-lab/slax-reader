import {validatePdfSources} from '@slax-reader/contracts/pdf'
import type {PdfMarkSource} from '@slax-reader/contracts/pdf'
import type {PdfMarkItem} from '../../pdf-types.ts'
import type {ReaderComment, ReaderMarkDetail} from '../../types.ts'
import {isObject} from './types.ts'

export function validPdfSources(source: unknown, documentId: string): source is PdfMarkSource[] {
  try {return Boolean(validatePdfSources(source, documentId))} catch {return false}
}
export function pdfSourceKey(source: PdfMarkSource[]) {
  return JSON.stringify(source.map(item => [item.version, item.document_id, item.page, item.text, item.quads]))
}
export function isPdfMarkDetail(value: unknown, documentId: string): value is ReaderMarkDetail {
  if (!isObject(value) || !Array.isArray(value.mark_list) || !isObject(value.user_list) && !(Array.isArray(value.user_list) && !value.user_list.length)) return false
  return value.mark_list.every(item => isObject(item) && [1, 2, 3, 4, 5].includes(Number(item.type)) &&
    ['id', 'user_id', 'parent_id', 'root_id'].every(key => Number.isSafeInteger(item[key])) && typeof item.comment === 'string' && typeof item.created_at === 'string' &&
    (item.is_deleted === undefined || typeof item.is_deleted === 'boolean') &&
    (validPdfSources(item.source, documentId) || Array.isArray(item.source) && !item.source.length || item.type === 3 && Number.isSafeInteger(item.source)) &&
    (item.approx_source == null || isObject(item.approx_source) && typeof item.approx_source.exact === 'string')) &&
    Object.values(value.user_list).every(user => isObject(user) && typeof user.username === 'string' && typeof user.avatar === 'string')
}
export function groupPdfMarks(marks: ReaderMarkDetail, documentId: string) {
  const records = new Map(marks.mark_list.map(mark => [mark.id, mark]))
  const groups = new Map<string, {source: PdfMarkSource[]; records: ReaderMarkDetail['mark_list']}>()
  const rootKeys = new Map<number, string>()
  for (const mark of records.values()) {
    if (mark.type === 3 || !validPdfSources(mark.source, documentId)) continue
    const key = pdfSourceKey(mark.source)
    rootKeys.set(mark.id, key)
    const group = groups.get(key) ?? {source: mark.source, records: []}
    group.records.push(mark)
    groups.set(key, group)
  }
  for (const mark of records.values()) {
    if (mark.type !== 3) continue
    let parent = records.get(mark.parent_id)
    const visited = new Set([mark.id])
    let key = rootKeys.get(mark.root_id)
    while (!key && parent && !visited.has(parent.id)) {
      visited.add(parent.id)
      key = rootKeys.get(parent.id)
      parent = records.get(parent.parent_id)
    }
    if (key) groups.get(key)?.records.push(mark)
  }
  const users = marks.user_list as Record<string, {username?: string; avatar?: string}>
  const anchors = new Map<string, PdfMarkSource>()
  const items: PdfMarkItem[] = Array.from(groups.values()).flatMap(group => {
    const descendants = group.records
    for (const record of descendants) anchors.set(String(record.id), group.source[0]!)
    const visible = new Set<number>()
    for (const item of descendants) if (!item.is_deleted && [2, 3, 5].includes(item.type)) {
      let parent: typeof item | undefined = item
      while (parent && !visible.has(parent.id) && descendants.includes(parent)) {
        visible.add(parent.id)
        parent = records.get(parent.parent_id)
      }
    }
    const comments = new Map<number, ReaderComment>()
    for (const item of descendants.filter(item => visible.has(item.id) && [2, 3, 5].includes(item.type))) comments.set(item.id, {
      markId: item.id, userId: item.user_id, comment: item.comment, username: users[String(item.user_id)]?.username ?? '',
      avatar: users[String(item.user_id)]?.avatar ?? '', isDeleted: item.is_deleted ?? false, createdAt: String(item.created_at), rootId: item.root_id, children: [],
    })
    const top: ReaderComment[] = []
    for (const item of descendants) {
      const comment = comments.get(item.id)
      if (!comment) continue
      const parent = comments.get(item.parent_id)
      const visited = new Set([item.id])
      let ancestor = records.get(item.parent_id)
      while (ancestor && !visited.has(ancestor.id)) {visited.add(ancestor.id); ancestor = records.get(ancestor.parent_id)}
      if (parent && !ancestor) parent.children.push(comment)
      else top.push(comment)
    }
    const stroke = descendants.filter(item => !item.is_deleted && (item.type === 1 || item.type === 4)).map(item => ({mark_id: item.id, userId: item.user_id}))
    if (!stroke.length && !comments.size) return []
    const anchor = descendants.filter(item => item.type !== 3).sort((left, right) => left.id - right.id)[0]!
    return [{id: String(anchor.id), source: group.source, approx: anchor.approx_source, stroke, comments: top}]
  })
  return {items, anchors}
}
