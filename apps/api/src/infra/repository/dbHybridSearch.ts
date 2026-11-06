import { Prisma, type PrismaClient } from '@prisma/hyperdrive-client'
import { inject, injectable } from '@/decorators/di'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import type { LazyInstance } from '@/decorators/lazy'
import { BookmarkRepo } from './dbBookmark'

export interface SearchTitleCandidate {
  type: 'article' | 'collection' | 'rss_feed' | 'rss_entry'
  entity_id: string
}

export interface SearchArticleRow {
  bookmark_id: number
  user_id: number
  bookmark_user_uuid: string
  cb_id: number
  title: string
  target_url: string
  collection_id: number | null
  collection_code: string | null
  collection_readable: boolean
}

export interface SearchCollectionRow {
  collection_id: number
  collection_code: string
  owner_id: number
  title: string
}

export interface SearchRssFeedRow {
  feed_id: string
  subscription_id: string
  title: string
}

export interface SearchRssEntryRow extends SearchRssFeedRow {
  entry_id: string
  source_title: string
  article_url: string | null
}

@injectable()
export class HybridSearchRepo {
  constructor(
    @inject(PRISIMA_HYPERDRIVE_CLIENT) private prismaPg: LazyInstance<PrismaClient>,
    @inject(BookmarkRepo) private bookmarks: BookmarkRepo
  ) {}

  private activeViewer(userId: number) {
    return Prisma.sql`EXISTS (SELECT 1 FROM sr_user viewer WHERE viewer.id = ${userId} AND viewer.deleted_at IS NULL)`
  }

  private readableMember(userId: number) {
    return Prisma.sql`collection.status = 1 AND collection.collection_code <> ''
      AND (bookmark.private_user = 0 OR bookmark.private_user = user_bookmark.user_id)
      AND ${this.bookmarks.readableCollectionBookmarks(Prisma.sql`collection.owner_id`, userId)}
      AND (collection.owner_id = ${userId} OR EXISTS (
        SELECT 1 FROM sr_user_collection_subscriber subscription
        WHERE subscription.collection_id = collection.id AND subscription.user_id = ${userId}
          AND subscription.is_active AND NOT subscription.is_deleted AND subscription.subscription_end_time > now()
      ))`
  }

  private articleScope(userId: number) {
    return Prisma.sql`${this.activeViewer(userId)} AND (
      (user_bookmark.user_id = ${userId} AND user_bookmark.deleted_at IS NULL
        AND (bookmark.private_user = 0 OR bookmark.private_user = ${userId}))
      OR (${this.readableMember(userId)})
    )`
  }

  private rssScope(userId: number) {
    return Prisma.sql`subscription.user_id = ${userId} AND ${this.activeViewer(userId)}
      AND EXISTS (SELECT 1 FROM sr_user_lab_feature lab WHERE lab.user_id = ${userId} AND lab.feature = 'rss' AND lab.enabled)`
  }

  async titleCandidates(userId: number, keyword: string, limit: number, candidates?: SearchTitleCandidate[]): Promise<Array<SearchTitleCandidate & { matched_title: string }>> {
    const pattern = `%${keyword.replace(/[!%_]/g, value => `!${value}`)}%`
    const only = (type: SearchTitleCandidate['type'], column: Prisma.Sql) => {
      if (!candidates) return Prisma.sql`true`
      const ids = [...new Set(candidates.filter(candidate => candidate.type === type).map(candidate => candidate.entity_id))]
      return ids.length ? Prisma.sql`${column} IN (${Prisma.join(ids)})` : Prisma.sql`false`
    }
    return this.prismaPg().$queryRaw<Array<SearchTitleCandidate & { matched_title: string }>>(Prisma.sql`
      SELECT type, entity_id, matched_title FROM (
        (SELECT 'article' AS type, bookmark.id::text AS entity_id,
            MIN((CASE WHEN lower(user_bookmark.alias_title) LIKE lower(${pattern}) ESCAPE '!' THEN user_bookmark.alias_title ELSE bookmark.title END) COLLATE "C") AS matched_title
          FROM sr_user_bookmark user_bookmark
          JOIN sr_bookmark bookmark ON bookmark.id = user_bookmark.bookmark_id
          LEFT JOIN sr_user_collection collection ON collection.owner_id = user_bookmark.user_id
          WHERE ${this.articleScope(userId)} AND ${only('article', Prisma.sql`bookmark.id::text`)}
            AND (lower(bookmark.title) LIKE lower(${pattern}) ESCAPE '!'
              OR lower(user_bookmark.alias_title) LIKE lower(${pattern}) ESCAPE '!')
          GROUP BY bookmark.id ORDER BY bookmark.id::text COLLATE "C" LIMIT ${limit})
        UNION ALL
        (SELECT 'collection' AS type, collection.id::text AS entity_id, collection.display_name AS matched_title
          FROM sr_user_collection collection JOIN sr_user owner ON owner.id = collection.owner_id
          WHERE collection.status = 1 AND collection.collection_code <> '' AND owner.deleted_at IS NULL
            AND ${this.activeViewer(userId)} AND ${only('collection', Prisma.sql`collection.id::text`)}
            AND lower(collection.display_name) LIKE lower(${pattern}) ESCAPE '!'
          ORDER BY collection.id::text COLLATE "C" LIMIT ${limit})
        UNION ALL
        (SELECT 'rss_feed' AS type, feed.id::text AS entity_id,
            CASE WHEN lower(subscription.remark) LIKE lower(${pattern}) ESCAPE '!' THEN subscription.remark ELSE feed.title END AS matched_title
          FROM sr_rss_subscription subscription JOIN sr_rss_feed feed ON feed.id = subscription.feed_id
          WHERE ${this.rssScope(userId)} AND ${only('rss_feed', Prisma.sql`feed.id::text`)}
            AND (lower(feed.title) LIKE lower(${pattern}) ESCAPE '!' OR lower(subscription.remark) LIKE lower(${pattern}) ESCAPE '!')
          ORDER BY feed.id::text COLLATE "C" LIMIT ${limit})
        UNION ALL
        (SELECT 'rss_entry' AS type, entry.id::text AS entity_id, entry.title AS matched_title
          FROM sr_rss_subscription subscription JOIN sr_rss_entry entry ON entry.feed_id = subscription.feed_id
          WHERE ${this.rssScope(userId)} AND ${only('rss_entry', Prisma.sql`entry.id::text`)}
            AND lower(entry.title) LIKE lower(${pattern}) ESCAPE '!'
          ORDER BY entry.id::text COLLATE "C" LIMIT ${limit})
      ) candidates ORDER BY type COLLATE "C", entity_id COLLATE "C" LIMIT ${limit}
    `)
  }

  async articles(userId: number, ids: number[]): Promise<SearchArticleRow[]> {
    if (!ids.length) return []
    return this.prismaPg().$queryRaw<SearchArticleRow[]>(Prisma.sql`
      SELECT bookmark.id AS bookmark_id, user_bookmark.user_id, user_bookmark.uuid AS bookmark_user_uuid,
        user_bookmark.id AS cb_id, COALESCE(NULLIF(btrim(user_bookmark.alias_title), ''), bookmark.title) AS title,
        bookmark.target_url, collection.id AS collection_id, collection.collection_code,
        COALESCE((${this.readableMember(userId)}), false) AS collection_readable
      FROM sr_user_bookmark user_bookmark
      JOIN sr_bookmark bookmark ON bookmark.id = user_bookmark.bookmark_id
      LEFT JOIN sr_user_collection collection ON collection.owner_id = user_bookmark.user_id
      WHERE bookmark.id IN (${Prisma.join(ids)}) AND ${this.articleScope(userId)}
      ORDER BY bookmark.id, user_bookmark.user_id, user_bookmark.id
    `)
  }

  async collections(userId: number, ids: number[], requireMembers = false): Promise<SearchCollectionRow[]> {
    if (!ids.length) return []
    const liveMember = Prisma.sql`EXISTS (
      SELECT 1 FROM sr_user_bookmark member JOIN sr_bookmark article ON article.id = member.bookmark_id
      LEFT JOIN sr_bookmark_share share ON share.bookmark_id = article.id AND share.user_id = member.user_id
      WHERE member.user_id = collection.owner_id AND member.deleted_at IS NULL AND member.type IN (0, 2)
        AND member.is_starred AND article.status = 'success' AND article.moderation_result = 0
        AND (article.private_user = 0 OR article.private_user = member.user_id)
        AND COALESCE(share.is_enable, owner.snapshot_sharing)
    )`
    return this.prismaPg().$queryRaw<SearchCollectionRow[]>(Prisma.sql`
      SELECT collection.id AS collection_id, collection.collection_code, collection.owner_id, collection.display_name AS title
      FROM sr_user_collection collection JOIN sr_user owner ON owner.id = collection.owner_id
      WHERE collection.id IN (${Prisma.join(ids)}) AND collection.status = 1 AND collection.collection_code <> ''
        AND owner.deleted_at IS NULL AND ${this.activeViewer(userId)} AND ${requireMembers ? liveMember : Prisma.sql`true`}
      ORDER BY collection.id
    `)
  }

  async rssFeeds(userId: number, ids: string[]): Promise<SearchRssFeedRow[]> {
    if (!ids.length) return []
    return this.prismaPg().$queryRaw<SearchRssFeedRow[]>(Prisma.sql`
      SELECT feed.id AS feed_id, subscription.id AS subscription_id, COALESCE(NULLIF(btrim(subscription.remark), ''), feed.title) AS title
      FROM sr_rss_subscription subscription JOIN sr_rss_feed feed ON feed.id = subscription.feed_id
      WHERE feed.id IN (${Prisma.join(ids)}) AND ${this.rssScope(userId)} ORDER BY feed.id
    `)
  }

  async rssEntries(userId: number, ids: string[]): Promise<SearchRssEntryRow[]> {
    if (!ids.length) return []
    return this.prismaPg().$queryRaw<SearchRssEntryRow[]>(Prisma.sql`
      SELECT entry.id AS entry_id, feed.id AS feed_id, subscription.id AS subscription_id, entry.title, entry.article_url,
        COALESCE(NULLIF(btrim(subscription.remark), ''), feed.title) AS source_title
      FROM sr_rss_subscription subscription JOIN sr_rss_feed feed ON feed.id = subscription.feed_id
      JOIN sr_rss_entry entry ON entry.feed_id = feed.id
      WHERE entry.id IN (${Prisma.join(ids)}) AND ${this.rssScope(userId)} ORDER BY entry.id
    `)
  }
}
