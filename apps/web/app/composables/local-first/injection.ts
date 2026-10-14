import type { UserNotificationMessageItem } from '@slax-reader/contracts/interface'
import type { BookmarkTag } from '@commons/frontend-types/models'
import type { ComputedRef, InjectionKey, MaybeRef, Ref } from 'vue'

// local-first 行为注入契约
// 默认 null = REST，由 local-first 插件 provide

// 书签可写操作（BookmarkCell）
export interface BookmarkActions {
  setArchive(uuid: string, archive: boolean): Promise<unknown>
  setStar(uuid: string, star: boolean): Promise<unknown>
  setTrashed(uuid: string, trashed: boolean): Promise<unknown>
  setAliasTitle(uuid: string, title: string): Promise<unknown> | unknown
}

// 本书签标签源 + 增删 + catalog（BookmarkTags 用）
export interface BookmarkTagSource {
  tags: ComputedRef<BookmarkTag[]>
  // 本地首查未返回前为 true，供消费方回退 SSR/REST tags 防闪空
  isLoading?: Readonly<Ref<boolean>>
  add(bookmarkUuid: string, tagUuid: string): Promise<unknown>
  remove(bookmarkUuid: string, tagUuid: string): Promise<unknown>
  // 多选一次提交：整组替换，比逐个 add 少 N-1 次写入
  setTags?(bookmarkUuid: string, tagUuids: string[]): Promise<unknown>
  userTags: ComputedRef<BookmarkTag[]>
  createUserTag(tagName: string): Promise<BookmarkTag>
}

// 用户标签源 + 新建（TagsHeader 用）
export interface UserTagSource {
  tags: ComputedRef<BookmarkTag[]>
  create(tagName: string): Promise<BookmarkTag>
}

// 列表卡片上的标签写操作：不带 useQuery，每张卡都能用
export interface BookmarkTagActions {
  setTags(bookmarkUuid: string, tagUuids: string[]): Promise<unknown>
  add(bookmarkUuid: string, tagUuid: string): Promise<unknown>
  remove(bookmarkUuid: string, tagUuid: string): Promise<unknown>
  createUserTag(tagName: string): Promise<BookmarkTag>
}

// 标签筛选页 “+” 的候选词：交集里还出现的标签，带剩余篇数
export interface BookmarkListTagSource {
  candidates(tagIds: Ref<string[]>): ComputedRef<BookmarkTag[]>
}

// 通知未读/列表/已读（UserNotification 用）
export interface NotificationFeed {
  unreadCount: ComputedRef<number>
  items: ComputedRef<UserNotificationMessageItem[]>
  markAllRead(): Promise<unknown>
}

export interface LocalFirstAdapter {
  bookmarkActions?: () => BookmarkActions | null
  bookmarkTagSource?: (bookmarkUuid: MaybeRef<string>) => BookmarkTagSource | null
  userTagSource?: () => UserTagSource | null
  bookmarkTagActions?: () => BookmarkTagActions | null
  bookmarkListTagSource?: () => BookmarkListTagSource | null
  // 默认无 provide = SW 推未读
  notificationRuntime?: () => { feed: NotificationFeed | null; unreadTransport: 'sw' | 'rest' }
}

export const LocalFirstAdapterKey: InjectionKey<LocalFirstAdapter> = Symbol('LocalFirstAdapter')

// 列表页共享的一份用户词表（local-first 下 userTagSource 是 useQuery，只能建一次，
// 由 BookmarkListContent provide，卡片上的 BookmarkTags inject；REST 下为 null）
export const SharedUserTagsKey: InjectionKey<UserTagSource | null> = Symbol('SharedUserTags')
