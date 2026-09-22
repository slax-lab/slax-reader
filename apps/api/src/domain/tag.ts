import type { BookmarkTag as BookmarkTagContract, TagRef, BookmarkTagSource, UserTagSource } from '@slax-reader/contracts'
import { inject, injectable } from '@/decorators/di'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { ContextManager } from '@/utils/context'
import { BookmarkNotFoundError, ErrorParam, ServerError } from '@/const/err'
import { normalizeTagName } from '@/utils/tags'

export type BookmarkTag = BookmarkTagContract<Date>
export type { TagRef } from '@slax-reader/contracts'

interface UserTagRow {
  id: number
  tag_name: string
  display: boolean
  source: string
  last_used_at: Date | null
}

@injectable()
export class TagService {
  constructor(@inject(BookmarkRepo) private bookmarkRepo: BookmarkRepo) {}

  /** hashid or uuid to DB id; 0 when neither resolves. Never feed a uuid to decodeId */
  public async resolveTagId(ctx: ContextManager, ref: TagRef): Promise<number> {
    if (ref.tag_uuid) {
      const tag = await this.bookmarkRepo.getUserTagByUuid(ctx.getUserId(), ref.tag_uuid)
      return tag?.id || 0
    }
    if (ref.tag_id) return ctx.hashIds.decodeId(ref.tag_id) || 0
    return 0
  }

  private toTag(ctx: ContextManager, row: UserTagRow): BookmarkTag {
    return {
      id: ctx.hashIds.encodeId(row.id),
      name: row.tag_name,
      show_name: row.tag_name,
      display: row.display,
      source: row.source === 'mine' ? 'mine' : 'auto',
      last_used_at: row.last_used_at
    }
  }

  public async addBookmarkTag(ctx: ContextManager, bmId: number, tagName?: string, tagId?: number): Promise<BookmarkTag> {
    const bmRepo = this.bookmarkRepo
    const userId = ctx.getUserId()

    const res = await bmRepo.getUserBookmark(bmId, userId)
    if (!res) throw BookmarkNotFoundError()

    // 传 tagName：用户打的词，建成（或认领为）我的标签再贴上
    // 传 tagId：词表里已有的词，贴上并恢复显示
    let tag: UserTagRow | null = null
    if (tagName) {
      const created = await bmRepo.createUserTag(userId, tagName)
      if (!created) throw ServerError()
      tag = created
    } else if (tagId) {
      tagId = ctx.hashIds.decodeId(tagId)
      const found = await bmRepo.getUserTagById(userId, tagId)
      if (!found) throw ErrorParam()
      if (!found.display) await bmRepo.updateUserTagDisplay(userId, tagId, true)
      tag = { ...found, display: true }
    }
    if (!tag) throw ServerError()

    await bmRepo.createBookmarkTag(bmId, userId, tag.id, tag.tag_name, 'user')
    await bmRepo.touchUserTagsLastUsed(userId, [tag.id])

    return { ...this.toTag(ctx, tag), added_by: 'user' }
  }

  public async addBookmarkTags(ctx: ContextManager, bmId: number, tags: { name: string; id?: number }[]): Promise<BookmarkTag[]> {
    const bmRepo = this.bookmarkRepo
    const userId = ctx.getUserId()

    const needInsert = tags.filter(t => !t.id)
    const needUpdate = tags.filter(t => t.id).map(t => ({ ...t, id: ctx.hashIds.decodeId(t.id!) }))

    if (!needInsert.length && !needUpdate.length) {
      throw ErrorParam()
    }

    let insertRes: { id: number; name: string }[] = []
    if (needInsert.length > 0) {
      insertRes =
        (
          await bmRepo.createUserTags(
            userId,
            needInsert.map(t => t.name)
          )
        )?.map(item => ({
          id: item.id,
          name: item.tag_name
        })) || []
      // createUserTags skips names that already exist; they are picked up by name below
      const inserted = new Set(insertRes.map(t => t.name))
      insertRes.push(...needInsert.filter(t => !inserted.has(t.name)).map(t => ({ id: 0, name: t.name })))
    }

    const needUpsert = [...insertRes, ...needUpdate]

    const updateRes = await bmRepo.updateUserTagsDisplay(
      userId,
      needUpsert.map(t => t.name),
      true
    )

    if (updateRes.length > 0) {
      // ON CONFLICT DO NOTHING legitimately reports 0 rows when every tag was already attached
      await bmRepo.upsertBookmarkTags(bmId, userId, updateRes, 'user')
      await bmRepo.touchUserTagsLastUsed(
        userId,
        updateRes.map(t => t.id)
      )
    }

    return updateRes.map(res => ({
      id: ctx.hashIds.encodeId(res.id),
      display: true,
      name: res.tag_name,
      show_name: res.tag_name,
      source: res.source === 'mine' ? 'mine' : 'auto',
      added_by: 'user'
    }))
  }

  /** remove from this one bookmark. The word stays in the vocabulary unless it is an orphaned auto tag */
  public async deleteBookmarkTag(ctx: ContextManager, bmId: number, tagId: number) {
    const bmRepo = this.bookmarkRepo
    const userId = ctx.getUserId()
    const res = await bmRepo.getUserBookmark(bmId, userId)
    if (!res) throw BookmarkNotFoundError()

    await bmRepo.deleteBookmarkTag(bmId, userId, tagId)

    const hasRecord = await bmRepo.countBookmarksByTag(userId, tagId)
    if (!hasRecord) {
      const tag = await bmRepo.getUserTagById(userId, tagId)
      if (tag && tag.source !== 'mine') await bmRepo.deleteUserTag(userId, tagId)
    }

    return null
  }

  /** the tags page "new tag" is a claim: an existing name (any case / width) becomes mine, else a new mine tag */
  public async createTag(ctx: ContextManager, tagName: string): Promise<BookmarkTag> {
    return this.promoteTag(ctx, { tag_name: tagName })
  }

  public async promoteTag(ctx: ContextManager, ref: TagRef & { tag_name?: string }): Promise<BookmarkTag> {
    const bmRepo = this.bookmarkRepo
    const userId = ctx.getUserId()

    if (ref.tag_name) {
      const name = normalizeTagName(ref.tag_name)
      if (!name) throw ErrorParam()

      const existing = await bmRepo.findUserTagByName(userId, name)
      if (existing) {
        if (existing.source !== 'mine') await bmRepo.updateUserTagSource(userId, existing.id, 'mine')
        if (!existing.display) await bmRepo.updateUserTagDisplay(userId, existing.id, true)
        return this.toTag(ctx, { ...existing, source: 'mine', display: true })
      }

      const created = await bmRepo.createUserTag(userId, name)
      if (!created) throw ErrorParam()
      return this.toTag(ctx, created)
    }

    const tagId = await this.resolveTagId(ctx, ref)
    if (tagId < 1) throw ErrorParam()
    const tag = await bmRepo.getUserTagById(userId, tagId)
    if (!tag) throw ErrorParam()

    if (tag.source !== 'mine') await bmRepo.updateUserTagSource(userId, tagId, 'mine')
    return this.toTag(ctx, { ...tag, source: 'mine' })
  }

  /** back to auto. Links untouched */
  public async demoteTag(ctx: ContextManager, ref: TagRef): Promise<BookmarkTag> {
    const bmRepo = this.bookmarkRepo
    const tagId = await this.resolveTagId(ctx, ref)
    if (tagId < 1) throw ErrorParam()
    const tag = await bmRepo.getUserTagById(ctx.getUserId(), tagId)
    if (!tag) throw ErrorParam()

    if (tag.source === 'mine') await bmRepo.updateUserTagSource(ctx.getUserId(), tagId, 'auto')
    return this.toTag(ctx, { ...tag, source: 'auto' })
  }

  /** the tags page delete: detach everywhere and hide the word */
  public async deleteTag(ctx: ContextManager, ref: TagRef) {
    const bmRepo = this.bookmarkRepo
    const userId = ctx.getUserId()
    const tagId = await this.resolveTagId(ctx, ref)
    if (tagId < 1) throw ErrorParam()
    const tag = await bmRepo.getUserTagById(userId, tagId)
    if (!tag) throw ErrorParam()

    await bmRepo.softDeleteBookmarkTagsByTag(userId, tagId)
    await bmRepo.deleteUserTag(userId, tagId)
    return null
  }

  public async editTag(ctx: ContextManager, tagId: number, tagName: string) {
    const bmRepo = this.bookmarkRepo
    const tag = await bmRepo.getUserTagById(ctx.getUserId(), tagId)
    if (!tag) throw ErrorParam()

    await Promise.allSettled([bmRepo.updateUserTag(ctx.getUserId(), tagId, tagName), bmRepo.updateBookmarkTag(ctx.getUserId(), tagId, tagName)])
    return null
  }

  /** live vocabulary, mine first by recency (ordering done in SQL) */
  public async listUserTags(ctx: ContextManager): Promise<BookmarkTag[]> {
    const res = await this.bookmarkRepo.getUserTags(ctx.getUserId())
    return res.map(item => this.toTag(ctx, item))
  }

  /**
   * For the "+" picker on the multi-tag filter page: tags still present inside the
   * intersection of `tagIds`, each with the number of bookmarks it would leave.
   */
  public async listCandidateTags(ctx: ContextManager, tagIds: number[]): Promise<BookmarkTag[]> {
    const bmRepo = this.bookmarkRepo
    const userId = ctx.getUserId()

    const selected = await bmRepo.getUserTagsByIds(userId, tagIds)
    if (selected.length !== tagIds.length) throw ErrorParam()

    const counts = await bmRepo.countTagsWithinBookmarks(
      userId,
      selected.map(t => t.uuid),
      tagIds
    )
    if (counts.length < 1) return []

    const countById = new Map(counts.map(c => [c.tag_id, Number(c.count)]))
    const candidates = await bmRepo.getUserTagsByIds(userId, [...countById.keys()])

    return candidates
      .filter(t => t.display)
      .map(t => ({ ...this.toTag(ctx, t), count: countById.get(t.id) || 0 }))
      .sort((a, b) => (b.count || 0) - (a.count || 0) || a.name.localeCompare(b.name))
  }

  public async getBookmarkTags(ctx: ContextManager, userId: number, bmId: number): Promise<BookmarkTag[]> {
    return (await this.bookmarkRepo.getBookmarkTags(userId, bmId)).map(t => ({
      show_name: t.tag_name,
      name: t.tag_name,
      id: ctx.hashIds.encodeId(t.tag_id),
      added_by: (t.source === 'ai' ? 'ai' : t.source === 'user' ? 'user' : '') as BookmarkTagSource
    }))
  }

  /** resolve names to ids; revive=true (user paths) also un-hides them, AI paths leave display alone */
  public async updateUserTagsDisplay(userId: number, names: string[], revive = false, createSource: UserTagSource = 'mine') {
    if (names.length < 1) return
    return this.bookmarkRepo.updateUserTagsDisplay(userId, names, revive, createSource)
  }

  public async upsertBookmarkTags(bmId: number, userId: number, tags: { id: number; tag_name: string }[], source: BookmarkTagSource = 'ai') {
    if (tags.length < 1) return
    return this.bookmarkRepo.upsertBookmarkTags(bmId, userId, tags, source)
  }
}
