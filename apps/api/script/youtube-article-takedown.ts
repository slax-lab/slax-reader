import 'dotenv/config'
import { Client } from 'pg'
import { pathToFileURL } from 'node:url'

/**
 * YouTube AI article takedown for one video. Marks every article row of the video as `takedown`
 * (and adds a marker row when there is none), which stops serving and blocks any new captions or
 * articles at once. The object keys are kept on the rows; the 5-minute sweep in the Worker then
 * deletes every caption, article and chunk object of the video and clears the keys.
 *
 *   HYPERDRIVE_DATABASE_URL=... pnpm tsx script/youtube-article-takedown.ts <videoId>           # dry run
 *   HYPERDRIVE_DATABASE_URL=... pnpm tsx script/youtube-article-takedown.ts <videoId> --apply
 */

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/

export function assertVideoId(videoId: string | undefined): string {
  if (!videoId || !VIDEO_ID_RE.test(videoId)) throw new Error('videoId must be the 11-character YouTube id')
  return videoId
}

export interface TakedownResult {
  video_id: string
  rows: number
  marked: number
  applied: boolean
}

export async function takedownVideo(client: Pick<Client, 'query'>, videoId: string, apply: boolean): Promise<TakedownResult> {
  assertVideoId(videoId)
  const rows = Number((await client.query<{ n: string }>('SELECT count(*)::text AS n FROM "sr_youtube_article" WHERE "video_id" = $1', [videoId])).rows[0].n)
  if (!apply) return { video_id: videoId, rows, marked: 0, applied: false }

  await client.query('BEGIN')
  try {
    const res = await client.query(
      `UPDATE "sr_youtube_article" SET "status" = 'takedown', "lease_until" = NULL, "next_retry_at" = NULL, "updated_at" = now() WHERE "video_id" = $1`,
      [videoId]
    )
    let marked = res.rowCount ?? 0
    if (marked === 0) {
      // No row yet: a marker row blocks future saves of this video
      const ins = await client.query(
        `INSERT INTO "sr_youtube_article" ("video_id", "source_hash", "target_language", "prompt_version", "status", "updated_at")
         VALUES ($1, 'takedown', 'en', 'v1', 'takedown', now()) ON CONFLICT DO NOTHING`,
        [videoId]
      )
      marked = ins.rowCount ?? 0
    }
    await client.query('COMMIT')
    return { video_id: videoId, rows, marked, applied: true }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.length === 0) {
    console.log('Usage: tsx script/youtube-article-takedown.ts <videoId> [--apply]. Dry run by default. Needs HYPERDRIVE_DATABASE_URL.')
    return
  }
  const videoId = assertVideoId(args.find(a => !a.startsWith('--')))
  if (!process.env.HYPERDRIVE_DATABASE_URL) throw new Error('HYPERDRIVE_DATABASE_URL is required')
  const client = new Client({ connectionString: process.env.HYPERDRIVE_DATABASE_URL, connectionTimeoutMillis: 10000, statement_timeout: 60000 })
  await client.connect()
  try {
    console.log(JSON.stringify(await takedownVideo(client, videoId, args.includes('--apply'))))
  } finally {
    await client.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
