import type { Prisma } from '@prisma/hyperdrive-client'

export interface StoredBookmarkObjects {
  id: number
  private_user: number
  write_version: number
  published_version: number
  content_key: string
  content_md_key: string
}

/** Lock the target before its stages so publication and deletion use one lock order. */
export async function lockBookmarkObjects(tx: Prisma.TransactionClient, bookmarkId: number) {
  const rows = await tx.$queryRaw<StoredBookmarkObjects[]>`
    SELECT id, private_user, write_version, published_version, content_key, content_md_key
    FROM sr_bookmark WHERE id = ${bookmarkId} FOR UPDATE
  `
  return rows[0]
}

/** Called inside the transaction that switches/removes the committed body pointer. */
export async function retireBookmarkObjects(tx: Prisma.TransactionClient, previous: StoredBookmarkObjects, next?: { content_key?: string; content_md_key?: string }) {
  const contentKey = next ? (next.content_key ?? previous.content_key) : ''
  const textKey = next ? (next.content_md_key ?? previous.content_md_key) : ''
  if (contentKey === previous.content_key && textKey === previous.content_md_key) return
  // Shared/public captures are owned by the shared publication lifecycle. They
  // must never be moved into the private cleanup queue when a public bookmark
  // pointer changes or is deleted.
  if (previous.private_user <= 0) return
  const now = new Date()
  const cleanupAfter = new Date(now.getTime() + 60 * 60_000)
  // Older private captures predate stage tracking. Register their keys before losing the pointer.
  // Historical shared rows are never enrolled here: another user may still depend on their keys.
  if (previous.private_user > 0 && previous.content_key) {
    const keys = [previous.content_key, previous.content_md_key]
    if (previous.content_key.startsWith('pdf/body/')) keys.push(previous.content_key.replace('pdf/body/', 'pdf/meta/').replace(/\.pdf$/, '.json'))
    await tx.$executeRaw`
      INSERT INTO sr_bookmark_object_stage (content_key, bookmark_id, write_version, keys, status, indexed_at, cleanup_after)
      VALUES (${previous.content_key}, ${previous.id}, ${previous.published_version}, ${keys.filter(Boolean)}::text[], 'published', ${now}, ${cleanupAfter})
      ON CONFLICT (content_key) DO NOTHING
    `
  }
  await tx.$executeRaw`
    UPDATE sr_bookmark_object_stage
    SET status = 'retired', updated_at = ${now}, cleanup_after = ${cleanupAfter},
        indexed_at = CASE WHEN index_attempted_at IS NULL THEN ${now} ELSE indexed_at END,
        keys = ARRAY(SELECT key FROM unnest(keys) AS key WHERE key <> ${contentKey} AND key <> ${textKey})
    WHERE bookmark_id = ${previous.id} AND status = 'published' AND content_key <> ${contentKey}
  `
}

/** Empty targets still need a durable work item for late writers and metadata cleanup. */
export async function stageEmptyBookmarkDeletion(tx: Prisma.TransactionClient, bookmark: StoredBookmarkObjects) {
  if (bookmark.content_key) return
  await tx.$executeRaw`
    INSERT INTO sr_bookmark_object_stage (content_key, bookmark_id, write_version, keys, status, indexed_at)
    VALUES (${`deleted-bookmark/${bookmark.id}`}, ${bookmark.id}, ${bookmark.write_version}, ARRAY[]::text[], 'retired', NOW())
    ON CONFLICT (content_key) DO NOTHING
  `
}

/** Bounded batches avoid loading every private bookmark or holding all account rows locked. */
export async function deletePrivateBookmarkBatch(tx: Prisma.TransactionClient, userId: number, limit = 100) {
  return tx.$queryRaw<Array<{ id: number; bucket_idx: number | null }>>`
    WITH targets AS MATERIALIZED (
      SELECT bookmark.id, bookmark.content_key, bookmark.content_md_key, bookmark.published_version,
        (SELECT vector.bucket_idx FROM sr_bookmark_vector_shard vector WHERE vector.bookmark_id = bookmark.id) AS bucket_idx
      FROM sr_bookmark bookmark
      WHERE bookmark.private_user = ${userId} AND bookmark.private_user > 0
      ORDER BY bookmark.id LIMIT ${limit} FOR UPDATE OF bookmark
    ), register AS (
      INSERT INTO sr_bookmark_object_stage (content_key, bookmark_id, write_version, keys, status, indexed_at, cleanup_after)
      SELECT COALESCE(NULLIF(content_key, ''), 'deleted-bookmark/' || id), id, published_version,
        array_remove(ARRAY[content_key, content_md_key,
          CASE WHEN content_key LIKE 'pdf/body/%' THEN regexp_replace(replace(content_key, 'pdf/body/', 'pdf/meta/'), '\.pdf$', '.json') ELSE '' END], ''),
        'retired', NOW(), NOW() + interval '1 hour'
      FROM targets ON CONFLICT (content_key) DO NOTHING
      RETURNING content_key
    ), retired AS (
      UPDATE sr_bookmark_object_stage stage SET status = 'retired', indexed_at = NOW(),
        updated_at = NOW(), cleanup_after = NOW() + interval '1 hour'
      FROM targets WHERE stage.bookmark_id = targets.id AND stage.status = 'published'
      RETURNING stage.id
    ), fork_rows AS (
      DELETE FROM sr_bookmark_fork row USING targets WHERE row.target_bookmark_id = targets.id
      RETURNING row.id
    ), receipt_rows AS (
      DELETE FROM sr_bookmark_save_receipt row USING targets WHERE row.target_bookmark_id = targets.id
      RETURNING row.id
    ), operation_rows AS (
      DELETE FROM sr_bookmark_fork_operation row USING targets WHERE row.target_bookmark_id = targets.id
      RETURNING row.id
    ), import_rows AS (
      DELETE FROM sr_bookmark_import_relation row USING targets
      WHERE row.bookmark_id = targets.id AND row.user_id = ${userId}
      RETURNING row.id
    ), media_rows AS (
      DELETE FROM sr_youtube_article_ref row USING targets
      WHERE row.bookmark_id = targets.id
      RETURNING row.id
    ), deleted AS (
      DELETE FROM sr_bookmark bookmark USING targets
      WHERE bookmark.id = targets.id
      RETURNING bookmark.id
    )
    SELECT deleted.id, targets.bucket_idx
    FROM deleted JOIN targets ON targets.id = deleted.id
  `
}
