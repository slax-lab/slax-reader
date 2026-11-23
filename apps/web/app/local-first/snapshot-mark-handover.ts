import type { MarkDetail } from '@commons/frontend-types/models'

// Marks written over REST on this page before it switches to local data. The REST mark list is not
// reloaded after a write, so these uuids extend what the reader has already seen.
export interface RestMarkWrites {
  added: ReadonlySet<string>
  deleted: ReadonlySet<string>
}

// Marks already painted from REST stay on screen until the local rows cover each of them; otherwise a lagging local
// database would remove a highlight the reader has just seen and paint it again when synchronization catches up.
export function localMarksCoverShown(shown: MarkDetail, local: MarkDetail, writes?: RestMarkWrites): boolean {
  const localByUuid = new Map(local.mark_list.map(mark => [mark.uuid, mark]))
  const coversResponse = shown.mark_list.every(mark => {
    const candidate = localByUuid.get(mark.uuid)
    const deleted = mark.is_deleted || !!writes?.deleted.has(mark.uuid)
    if (!candidate) return deleted
    return candidate.is_deleted === deleted && (deleted || (candidate.comment ?? '') === (mark.comment ?? ''))
  })
  if (!coversResponse || !writes) return coversResponse
  for (const uuid of writes.added) {
    if (writes.deleted.has(uuid)) continue
    const candidate = localByUuid.get(uuid)
    if (!candidate || candidate.is_deleted) return false
  }
  for (const uuid of writes.deleted) {
    const candidate = localByUuid.get(uuid)
    if (candidate && !candidate.is_deleted) return false
  }
  return true
}
