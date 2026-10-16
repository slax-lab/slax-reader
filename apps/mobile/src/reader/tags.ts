export interface ReaderTag {id: string; tag_name: string}
export interface TagDraft<T extends ReaderTag> {added: T[]; removed: string[]}
export const emptyTagDraft = <T extends ReaderTag>(): TagDraft<T> => ({added: [], removed: []})

/** Match the source sheet's local edits while acknowledging streamed changes. */
export function reconcileTagDraft<T extends ReaderTag>(draft: TagDraft<T>, remoteIds: readonly string[]): TagDraft<T> {
  return {added: draft.added.filter(tag => !remoteIds.includes(tag.id)), removed: draft.removed.filter(id => remoteIds.includes(id))}
}
export function selectedTagIds<T extends ReaderTag>(draft: TagDraft<T>, remoteIds: readonly string[]): string[] {
  return [...new Set([...remoteIds, ...draft.added.map(tag => tag.id)])].filter(id => !draft.removed.includes(id))
}
export function addDraftTag<T extends ReaderTag>(draft: TagDraft<T>, tag: T, remoteIds: readonly string[]): TagDraft<T> {
  return {added: remoteIds.includes(tag.id) || draft.added.some(item => item.id === tag.id) ? draft.added : [...draft.added, tag], removed: draft.removed.filter(id => id !== tag.id)}
}
export function removeDraftTag<T extends ReaderTag>(draft: TagDraft<T>, id: string, remoteIds: readonly string[]): TagDraft<T> {
  return {added: draft.added.filter(tag => tag.id !== id), removed: remoteIds.includes(id) && !draft.removed.includes(id) ? [...draft.removed, id] : draft.removed}
}
export function similarTags<T extends ReaderTag>(tags: readonly T[], selected: readonly string[], query: string): T[] {
  if (!query) return []
  const term = query.toLowerCase()
  const rank = (name: string) => name === term ? 0 : name.startsWith(term) ? 1 : 2
  return tags.filter(tag => !selected.includes(tag.id) && tag.tag_name.toLowerCase().includes(term)).sort((a, b) => rank(a.tag_name.toLowerCase()) - rank(b.tag_name.toLowerCase()))
}
