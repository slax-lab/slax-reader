import type { IBookmarkProvider } from '@slax-reader/selection/adapters'

/**
 * Dweb端书签信息提供者
 *
 * 从config直接获取书签相关信息
 */
export class DwebBookmarkProvider implements IBookmarkProvider {
  private bookmarkId?: number
  private bookmarkUid?: string
  private shareCode?: string
  private collection?: { code: string; cb_id: number }
  private ownerUserId?: number

  constructor(config: { bookmarkId?: number; bookmarkUid?: string; shareCode?: string; collection?: { code: string; cb_id: number }; ownerUserId?: number }) {
    this.bookmarkId = config.bookmarkId
    this.bookmarkUid = config.bookmarkUid
    this.shareCode = config.shareCode
    this.collection = config.collection
    this.ownerUserId = config.ownerUserId
  }

  async getBookmarkId(): Promise<number> {
    if (this.bookmarkId === undefined) {
      throw new Error('BookmarkId is not configured')
    }
    return this.bookmarkId
  }

  getBookmarkUid(): string | undefined {
    return this.bookmarkUid
  }

  getShareCode(): string | undefined {
    return this.shareCode
  }

  getCollectionInfo(): { code: string; cb_id: number } | undefined {
    return this.collection
  }

  getOwnerUserId(): number | undefined {
    return this.ownerUserId
  }
}
