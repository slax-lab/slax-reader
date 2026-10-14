import type { BookmarkTag } from '@commons/frontend-types/models'

const time = (v?: string | null) => (v ? Date.parse(v) || 0 : 0)

/** 我的标签在前，其次最近使用时间倒序，没用过的排最后；同组内保持原顺序 */
export function sortBookmarkTags(tags: BookmarkTag[]): BookmarkTag[] {
  return tags
    .map((tag, index) => ({ tag, index }))
    .sort((a, b) => {
      const mine = Number(b.tag.source === 'mine') - Number(a.tag.source === 'mine')
      if (mine !== 0) return mine
      const used = time(b.tag.last_used_at) - time(a.tag.last_used_at)
      if (used !== 0) return used
      return a.index - b.index
    })
    .map(({ tag }) => tag)
}
