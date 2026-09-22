import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { describe, expect, test } from 'vitest'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { CollectionService } from '@/domain/collection'
import { CollectionController } from '@/handler/http/collectionController'
import { createMockCtx } from '@test/helpers/mockFactory'

const describeLocal = process.env.RUN_COLLECTION_READ_SQL === '1' ? describe : describe.skip

describeLocal('collection authorization before pagination (isolated PostgreSQL schema)', () => {
  test('ten private articles do not hide the eleventh public article and count matches visibility', async () => {
    const schema = `collection_read_${randomUUID().replaceAll('-', '')}`
    const setup = `BEGIN; CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema};
      CREATE TABLE sr_user (id int, deleted_at timestamp, snapshot_sharing boolean);
      CREATE TABLE sr_bookmark (id int, uuid text, title text, host_url text, target_url text, site_name text, content_icon text, content_cover text, content_word_count int, description text, byline text, status text, moderation_result int, created_at timestamp, updated_at timestamp, published_at timestamp);
      CREATE TABLE sr_user_bookmark (id int, user_id int, bookmark_id int, uuid text, alias_title text, starred_at timestamp, type int, deleted_at timestamp, is_starred boolean);
      CREATE TABLE sr_bookmark_share (bookmark_id int, user_id int, is_enable boolean, show_line boolean, show_comment boolean, show_userinfo boolean);
      CREATE TABLE sr_user_bookmark_stats (bookmark_uuid text, comment_count int, first_comment jsonb);
      INSERT INTO sr_user VALUES (42, NULL, false);
      INSERT INTO sr_bookmark (id,uuid,title,moderation_result) SELECT n, n::text, 'article-' || n, 0 FROM generate_series(1,12) n;
      INSERT INTO sr_user_bookmark (id,user_id,bookmark_id,uuid,starred_at,type,is_starred) SELECT n,42,n,n::text,CURRENT_TIMESTAMP - n * interval '1 minute',0,true FROM generate_series(1,12) n;
      INSERT INTO sr_bookmark_share SELECT n,42,n=11,true,true,true FROM generate_series(1,11) n;`
    const repo = Object.create(BookmarkRepo.prototype) as BookmarkRepo
    const db = {
      $queryRaw: async (query: { text: string; values: unknown[] }) => {
        const sql = query.text.replace(/\$(\d+)/g, (_match, n) => {
          const value = query.values[Number(n) - 1]
          if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Unexpected fixture parameter')
          return String(value)
        })
        const output = execFileSync('docker', ['exec', '-i', 'slax-payment-review', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1'], {
          input: `${setup} SELECT COALESCE(json_agg(result), '[]'::json) FROM (${sql}) result; ROLLBACK;`, encoding: 'utf8'
        })
        return JSON.parse(output.trim())
      }
    }
    ;(repo as any).clientPg = () => db
    const owner = { id: 42, name: 'Owner', deleted_at: null }
    const service = new CollectionService({
      getUserShareCollectByCode: async () => ({ id: 1, owner_id: 42, status: 1 }),
      getCollectionStats: async () => ({ starred_count: 12, subscriber_count: 1 })
    } as never, { getInfo: async () => owner, getInfoByUserId: async () => owner } as never, repo)
    const controller = new CollectionController(service, {} as never)
    const response = await controller.handleShareCollectRequest(createMockCtx({ userId: 0 }), new Request('https://test/v1/collection/?collect_code=collection'))
    const text = await response.text()
    expect(text).toContain('article-11')
    expect(text).toContain('"bookmark_count":1')
    expect(text).not.toContain('article-10')
    expect(text).not.toContain('article-12')
    expect(await repo.listUserStarBookmarksWithStatsByTargetUser(42, 10, 10, 0)).toEqual([])
    expect(await repo.countReadableCollectionBookmarks(42, 42)).toBe(12)
  }, 30000)
})
