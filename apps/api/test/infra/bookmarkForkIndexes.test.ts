import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const expansion = readFileSync(new URL('../../prisma/pg_migrations/20261019000000_private_bookmark_fork/migration.sql', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../../prisma/pg_migrations/20261020000000_bookmark_fork_lifecycle_indexes/migration.sql', import.meta.url), 'utf8')
const schema = readFileSync(new URL('../../prisma/pgsql.prisma', import.meta.url), 'utf8')

type Plan = { [key: string]: unknown; Plans?: Plan[] }
const nodes = (plan: Plan): Plan[] => [plan, ...(plan.Plans || []).flatMap(nodes)]
const indexes = (plan: Plan) =>
  nodes(plan)
    .map(node => node['Index Name'])
    .filter(Boolean)
const scans = (plan: Plan, table: string) => nodes(plan).filter(node => node['Relation Name'] === table)

const pendingFilter = `status IN ('published', 'retired') AND indexed_at IS NULL`
const globalPending = `
  SELECT bookmark_id FROM sr_bookmark_object_stage stage
  WHERE ${pendingFilter}
    AND EXISTS (SELECT 1 FROM sr_bookmark bookmark WHERE bookmark.id=stage.bookmark_id)
  GROUP BY bookmark_id ORDER BY MIN(updated_at) LIMIT 20`
const boundedPending = `
  WITH candidates AS MATERIALIZED (
    SELECT bookmark_id, updated_at FROM sr_bookmark_object_stage stage
    WHERE ${pendingFilter}
      AND EXISTS (SELECT 1 FROM sr_bookmark bookmark WHERE bookmark.id=stage.bookmark_id)
    ORDER BY updated_at, id LIMIT 80
  )
  SELECT bookmark_id FROM candidates GROUP BY bookmark_id ORDER BY MIN(updated_at), bookmark_id LIMIT 20`

const lookupQueries = {
  lineage: 'SELECT * FROM sr_bookmark_fork WHERE target_bookmark_id=42 AND write_version=1234 ORDER BY id DESC LIMIT 1',
  operation: "SELECT id FROM sr_bookmark_fork_operation WHERE target_bookmark_id=42 AND status='complete'",
  owner: 'SELECT id FROM sr_bookmark WHERE private_user=78 ORDER BY id LIMIT 100',
  progress: 'SELECT status,count(*) FROM sr_bookmark_import_relation WHERE import_id=42 GROUP BY status',
  revision: 'SELECT id FROM sr_bookmark_import_relation WHERE user_id=77 AND bookmark_id=77 AND import_id=1 AND write_version=1',
  stage: "SELECT id FROM sr_bookmark_object_stage WHERE bookmark_id=42 AND status='published' ORDER BY updated_at"
}

const db = new PGlite()
const before: Record<string, Plan> = {}
async function explain(sql: string): Promise<Plan> {
  const result = await db.query<{ 'QUERY PLAN': { Plan: Plan }[] }>(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`)
  return result.rows[0]['QUERY PLAN'][0].Plan
}

beforeAll(async () => {
  await db.exec(`
    CREATE TABLE sr_bookmark (
      id SERIAL PRIMARY KEY, target_url TEXT NOT NULL, private_user INTEGER NOT NULL DEFAULT 0,
      content_key TEXT NOT NULL DEFAULT '', content_md_key TEXT NOT NULL DEFAULT '', UNIQUE(target_url, private_user)
    );
    CREATE TABLE sr_bookmark_import_relation (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL DEFAULT 0, bookmark_id INTEGER NOT NULL DEFAULT 0,
      import_id INTEGER NOT NULL DEFAULT 0, status INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX sr_bookmark_import_relation_user_id_import_id_bookmark_id_idx
      ON sr_bookmark_import_relation(user_id,import_id,bookmark_id);
    CREATE TABLE sr_youtube_article_ref (id SERIAL PRIMARY KEY);
  `)
  await db.exec(expansion)
  await db.exec(`
    INSERT INTO sr_bookmark(target_url,private_user,content_key)
      SELECT 'https://example.test/'||g,CASE WHEN g%10=0 THEN 77 ELSE g%1000 END,'body/'||g FROM generate_series(1,40000) g;
    INSERT INTO sr_bookmark_fork(target_bookmark_id,target_user_id,source_bookmark_id,source_user_id,source_uuid,write_version,status)
      SELECT g,1,1,2,'source',1,'superseded' FROM generate_series(1,40000) g;
    INSERT INTO sr_bookmark_fork(target_bookmark_id,target_user_id,source_bookmark_id,source_user_id,source_uuid,write_version,status)
      SELECT 42,1,1,2,'source',g,'superseded' FROM generate_series(2,4001) g;
    INSERT INTO sr_bookmark_fork_operation(user_id,idempotency_key,source_uuid,target_bookmark_id,target_uuid,write_version,write_mode,status)
      SELECT g%1000,g::text,'source',(g-1)%40000+1,'target',1,'created','complete' FROM generate_series(1,80000) g;
    INSERT INTO sr_bookmark_import_relation(user_id,bookmark_id,import_id,status,write_version)
      SELECT g%1000,(g-1)%40000+1,(g-1)/500+1,g%3,(g-1)/40000+1 FROM generate_series(1,80000) g;
    INSERT INTO sr_bookmark_object_stage(content_key,bookmark_id,write_version,keys,status,indexed_at,updated_at)
      SELECT 'stage/'||g,(g-1)%40000+1,1,ARRAY['stage/'||g],
        CASE WHEN g%100=0 THEN 'deleted' WHEN g%20=1 THEN 'staged' WHEN g%2=0 THEN 'published' ELSE 'retired' END,
        CASE WHEN g%10 IN(2,3) THEN NULL ELSE timestamp '2026-10-01' END,
        timestamp '2026-10-01' + g*interval '1 second'
      FROM generate_series(1,80000) g;
    INSERT INTO sr_bookmark_object_stage(content_key,bookmark_id,write_version,keys,status,indexed_at,index_attempted_at,updated_at)
      SELECT 'hotspot/'||g,42,g,ARRAY['hotspot/'||g],'retired',NULL,timestamp '2026-10-01',timestamp '2000-01-01'
      FROM generate_series(1,200) g;
    ANALYZE;
  `)
  before.lineage = await explain(lookupQueries.lineage)
  before.operation = await explain(lookupQueries.operation)
  before.owner = await explain(lookupQueries.owner)
  before.progress = await explain(lookupQueries.progress)
  before.pending = await explain(globalPending)
  await db.exec(migration)
  await db.exec('ANALYZE')
}, 60_000)

afterAll(async () => {
  await db.close()
})

describe('Fork lifecycle and query index migration', () => {
  it('keeps existing rows and lets old writers omit the cleanup fields', async () => {
    expect((await db.query<{ count: number }>('SELECT count(*)::integer AS count FROM sr_bookmark')).rows[0].count).toBe(40000)
    expect((await db.query<{ count: number }>('SELECT count(*)::integer AS count FROM sr_bookmark_object_stage')).rows[0].count).toBe(80200)
    const inserted = await db.query<{ deferred: boolean; cleanup_completed_at: null }>(`
      INSERT INTO sr_bookmark_object_stage(content_key,bookmark_id,write_version,keys)
      VALUES('old-writer',42,0,ARRAY['old-writer'])
      RETURNING cleanup_after > CURRENT_TIMESTAMP + interval '59 minutes' AS deferred,cleanup_completed_at`)
    expect(inserted.rows[0]).toEqual({ deferred: true, cleanup_completed_at: null })
    expect(
      (await db.query<{ count: number }>(`SELECT count(*)::integer AS count FROM sr_bookmark_object_stage WHERE status='deleted' AND cleanup_completed_at IS NULL`)).rows[0].count
    ).toBe(0)
  })

  it('tracks SQL-owned partial indexes explicitly and replaces only superseded new stage indexes', async () => {
    const found = await db.query<{ indexname: string; indexdef: string }>(`SELECT indexname,indexdef FROM pg_indexes WHERE tablename='sr_bookmark_object_stage'`)
    const pending = found.rows.find(row => row.indexname === 'sr_bookmark_object_stage_pending_index_idx')!
    expect(pending.indexdef).toContain('(updated_at, id, bookmark_id)')
    expect(pending.indexdef).toContain('indexed_at IS NULL')
    expect(pending.indexdef).toContain("'published'")
    expect(pending.indexdef).toContain("'retired'")
    expect(schema).toContain('sr_bookmark_object_stage_pending_index_idx')
    expect(found.rows.map(row => row.indexname)).not.toContain('sr_bookmark_object_stage_status_indexed_at_idx')
    expect(found.rows.map(row => row.indexname)).not.toContain('sr_bookmark_object_stage_status_updated_at_idx')
    expect(found.rows.map(row => row.indexname)).not.toContain('sr_bookmark_object_stage_bookmark_id_write_version_idx')
    expect(
      (await db.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE indexname='sr_bookmark_import_relation_user_id_import_id_bookmark_id_idx'`)).rows
    ).toHaveLength(1)
  })

  it('uses a single version lookup without sorting or scanning the lineage history', async () => {
    const plan = await explain(lookupQueries.lineage)
    expect(indexes(plan)).toContain('sr_bookmark_fork_target_bookmark_id_write_version_id_idx')
    expect(nodes(plan).some(node => node['Node Type'] === 'Sort')).toBe(false)
    expect(scans(plan, 'sr_bookmark_fork')[0]['Actual Rows']).toBe(1)
    expect(scans(before.lineage, 'sr_bookmark_fork').reduce((sum, node) => sum + Number(node['Rows Removed by Filter'] || 0), 0)).toBeGreaterThan(1000)
  })

  it('avoids table scans for destination operations, private owners, and import progress', async () => {
    for (const [query, index, table] of [
      ['operation', 'sr_bookmark_fork_operation_target_bookmark_id_status_idx', 'sr_bookmark_fork_operation'],
      ['owner', 'sr_bookmark_private_user_id_idx', 'sr_bookmark'],
      ['progress', 'sr_bm_import_relation_progress_idx', 'sr_bookmark_import_relation']
    ]) {
      const plan = await explain(lookupQueries[query as keyof typeof lookupQueries])
      expect(indexes(plan)).toContain(index)
      expect(scans(plan, table).every(node => node['Node Type'] !== 'Seq Scan')).toBe(true)
      expect(indexes(before[query])).not.toContain(index)
    }
    expect(indexes(await explain(lookupQueries.revision))).toContain('sr_bm_import_relation_revision_idx')
    expect((await db.query(lookupQueries.revision)).rows).toEqual([{ id: 77 }])
    expect(indexes(await explain(lookupQueries.stage))).toContain('sr_bookmark_object_stage_bookmark_id_status_updated_at_idx')
    expect(indexes(await explain(`SELECT id FROM sr_bookmark WHERE content_key='body/42'`))).toContain('sr_bookmark_content_key_idx')
    expect(indexes(await explain(`SELECT id FROM sr_bookmark WHERE content_md_key='text/42'`))).toContain('sr_bookmark_content_md_key_idx')
  })

  it('bounds pending aggregation to 80 candidates and advances past duplicate hot spots on the next repair batch', async () => {
    const plan = await explain(boundedPending)
    expect(indexes(plan)).toContain('sr_bookmark_object_stage_pending_index_idx')
    const candidateScan = nodes(plan).find(node => node['Node Type'] === 'CTE Scan')!
    expect(candidateScan['Actual Rows']).toBe(80)
    const oldScanned = scans(before.pending, 'sr_bookmark_object_stage').reduce((sum, node) => sum + Number(node['Actual Rows'] || 0), 0)
    expect(oldScanned).toBeGreaterThan(10000)
    expect((await db.query<{ bookmark_id: number }>(boundedPending)).rows).toEqual([{ bookmark_id: 42 }])
    await db.exec(`UPDATE sr_bookmark_object_stage SET updated_at=timestamp '2100-01-01' WHERE bookmark_id=42 AND ${pendingFilter}`)
    const next = (await db.query<{ bookmark_id: number }>(boundedPending)).rows
    expect(next).toHaveLength(20)
    expect(next.every(row => row.bookmark_id !== 42)).toBe(true)
  })

  it('uses cleanup scheduling independently of search heartbeats', async () => {
    await db.exec(`UPDATE sr_bookmark_object_stage SET cleanup_after=timestamp '2000-01-01' WHERE status='staged'`)
    const beforeTouch = (await db.query<{ cleanup_after: Date }>(`SELECT cleanup_after FROM sr_bookmark_object_stage WHERE content_key='stage/1'`)).rows[0]
    await db.exec(`UPDATE sr_bookmark_object_stage SET updated_at=CURRENT_TIMESTAMP WHERE content_key='stage/1'`)
    expect((await db.query(`SELECT cleanup_after FROM sr_bookmark_object_stage WHERE content_key='stage/1'`)).rows[0]).toEqual(beforeTouch)
    const plan = await explain(`SELECT id FROM sr_bookmark_object_stage WHERE status='staged' AND cleanup_after<CURRENT_TIMESTAMP ORDER BY cleanup_after LIMIT 100`)
    expect(indexes(plan)).toContain('sr_bookmark_object_stage_status_cleanup_after_idx')
    expect(nodes(plan).some(node => node['Node Type'] === 'Sort')).toBe(false)
  })
})
