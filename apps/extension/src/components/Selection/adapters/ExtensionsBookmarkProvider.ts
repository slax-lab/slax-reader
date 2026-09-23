import type { IBookmarkProvider } from '@slax-reader/selection/adapters'

/**
 * Extensions端书签信息提供者
 *
 * 通过异步查询函数获取书签ID
 */
export class ExtensionsBookmarkProvider implements IBookmarkProvider {
  private bookmarkIdQuery: () => Promise<number>

  constructor(bookmarkIdQuery: () => Promise<number>) {
    this.bookmarkIdQuery = bookmarkIdQuery
  }

  async getBookmarkId(): Promise<number> {
    return await this.bookmarkIdQuery()
  }

  // Extensions不使用以下方法
  getShareCode = undefined
  getCollectionInfo = undefined
  getOwnerUserId = undefined
}
