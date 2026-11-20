import type { MarkDetail } from '@commons/frontend-types/models'

// Marks already painted from REST stay on screen until the local rows cover each of them; otherwise a lagging local
// database would remove a highlight the reader has just seen and paint it again when synchronization catches up.
export function localMarksCoverShown(shown: MarkDetail, local: MarkDetail): boolean {
  const localByUuid = new Map(local.mark_list.map(mark => [mark.uuid, mark]))
  return shown.mark_list.every(mark => {
    const candidate = localByUuid.get(mark.uuid)
    if (!candidate) return mark.is_deleted
    return candidate.is_deleted === mark.is_deleted && (candidate.comment ?? '') === (mark.comment ?? '')
  })
}
