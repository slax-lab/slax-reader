// 路由 seam 汇总：统一跳 /b/
import { type BookmarkOpenedFrom, eventEntryUrl } from '@/utils/eventAttribution'

import type { HighlightItem } from '@commons/types/interface'

export type BookmarkSnapshotSource = {
  id?: number
  bookmark_id?: number
  bookmark_user_uuid?: string
}

export function useSlaxRoutes() {
  const route = useRoute()
  const source = useState<BookmarkOpenedFrom>('bookmark-opened-from', () => 'bookmarks')
  const decorateReaderRoute = (path: string): string => (route.path === '/bookmarks' || route.path === '/' ? eventEntryUrl(path, source.value || 'bookmarks') : path)

  return {
    decorateReaderRoute,
    // 统一跳 /b/，标识是 uuid
    // REST 用 bookmark_user_uuid，LF 回退 source_id
    highlightRoute: (item: HighlightItem): string => decorateReaderRoute(`/b/${item.bookmark_user_uuid || item.source_id}?highlight=${item.id}`),
    // /b/[id] 标识是 uuid
    // REST 列表优先 uuid，LF 回退 id
    snapshotRoute: (source: BookmarkSnapshotSource): string | null => {
      const uuid = source.bookmark_user_uuid || source.id
      if (!uuid) return null
      return decorateReaderRoute(`/b/${uuid}`)
    }
  }
}
