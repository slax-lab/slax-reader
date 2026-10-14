import type { BookmarkRepo } from '@/infra/repository/dbBookmark'
import type { UserRepo } from '@/infra/repository/dbUser'

export async function resolveBookmarkReadAccess(bookmarkRepo: BookmarkRepo, userRepo: UserRepo, userId: number, uuid: string) {
  const bookmark = await bookmarkRepo.getUserBookmarkByUuidWithDetail(uuid)
  if (!bookmark?.bookmark) return null
  if (userId > 0 && bookmark.user_id === userId) return { bookmark, share: null }
  if (bookmark.deleted_at || bookmark.bookmark.moderation_result > 0) return null

  const owner = await userRepo.getInfoByUserId(bookmark.user_id)
  if (!owner || owner.deleted_at) return null
  const share = await bookmarkRepo.getBookmarkShareByBookmarkId(bookmark.bookmark_id, bookmark.user_id)
  if (share ? !share.is_enable : owner.snapshot_sharing !== true) return null

  return { bookmark, share }
}
