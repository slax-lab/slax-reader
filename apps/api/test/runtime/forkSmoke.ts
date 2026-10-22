/** Real Edge/Core HTTP + PostgreSQL + local R2 exercise, enabled by FORK_SMOKE=1. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getPlatformProxy } from 'wrangler'
import { renderMediaArticle, renderPodcastBody, type PodcastPlayerInfo } from '../../src/utils/podcastArticle'
import type { YoutubeArticleDocument } from '../../src/utils/youtubeArticle'
import { normalizedMediaContent, podcastInputFingerprint } from '../../src/utils/mediaSnapshot'
import { pdfFixture } from '../helpers/pdfFixture'
import type { LocalResources } from './localResources'

type Source = { id: number; uuid: string; url: string; key: string; textKey: string; type: number }
const sqlString = (value: string) => `'${value.replace(/'/g, "''")}'`

export async function prepareForkSmoke(resources: LocalResources, container: string, state: string) {
  const config = resolve(resources.workspace, 'fork-r2.json')
  writeFileSync(
    config,
    JSON.stringify({
      name: 'fork-fixtures',
      compatibility_date: '2025-05-05',
      r2_buckets: [{ binding: 'OSS', bucket_name: 'http-reader' }],
      kv_namespaces: [{ binding: 'KV', id: '00000000000000000000000000000001' }]
    })
  )
  const proxy = await getPlatformProxy<{ OSS: R2Bucket; KV: KVNamespace }>({
    configPath: config,
    envFiles: [resources.emptyEnv],
    remoteBindings: false,
    persist: { path: resolve(state, 'v3') }
  })
  try {
    const bucket = proxy.env.OSS
    const sql = (query: string) => resources.sql(container, 'http_reader', query)
    const json = (query: string) => JSON.parse(sql(`SELECT row_to_json(r) FROM (${query}) r`))
    sql(
      "UPDATE sr_user SET lang='en',ai_lang='en'; INSERT INTO sr_user_lab_feature(user_id,feature,enabled,updated_at) SELECT u.id,f.key,true,now() FROM sr_user u CROSS JOIN (VALUES ('pdf'),('youtube'),('youtube_article'),('podcast')) f(key);"
    )
    const sources: Record<string, Source> = {}
    const source = (name: string, url: string, key: string, textKey: string, type = 0) => {
      const id = Number(
        sql(
          `INSERT INTO sr_bookmark(title,target_url,host_url,status,private_user,content_key,content_md_key,created_at,updated_at,published_at) VALUES (${sqlString(name)},${sqlString(url)},'fixture.invalid','success',2,${sqlString(key)},${sqlString(textKey)},now(),now(),now()) RETURNING id`
        )
      )
      const uuid = sql(
        `INSERT INTO sr_user_bookmark(user_id,bookmark_id,type,is_starred,alias_title,updated_at) VALUES(2,${id},${type},true,'Personal alias',now()) RETURNING uuid`
      )
      return (sources[name] = { id, uuid, url, key, textKey, type })
    }
    const html = source('html', 'https://fixture.invalid/article', 'legacy/article.html', 'legacy/article.txt')
    await bucket.put(html.key, '<article><h1>Independent article</h1><p>Original source body.</p></article>')
    await bucket.put(html.textKey, 'A stale text object must not be copied.')
    source('shortcut', 'https://fixture.invalid/shortcut', '', '', 1)
    const pdf = pdfFixture(['Independent PDF'], [], 'Snapshot PDF')
    const digest = createHash('sha256').update(pdf).digest('hex')
    for (const kind of ['uploadedPdf', 'urlPdf']) {
      const item = source(kind, kind === 'uploadedPdf' ? `slax-pdf://2/${digest}` : 'https://fixture.invalid/report.pdf', `pdf/body/${kind}.pdf`, `text/pdf/${kind}.txt`, 2)
      await bucket.put(item.key, pdf, { httpMetadata: { contentType: 'application/pdf' }, customMetadata: { sha256: digest, filename: 'snapshot.pdf' } })
      await bucket.put(item.textKey, 'Independent PDF')
      await bucket.put(`pdf/meta/${kind}.json`, JSON.stringify({ text_status: 'ready', pages: 1 }))
      sql(`UPDATE sr_user_bookmark SET metadata=metadata || jsonb_build_object('pdf_document_id',${sqlString(digest)}::text) WHERE uuid=${sqlString(item.uuid)}`)
    }
    for (const kind of ['youtube', 'podcast'] as const) {
      const item = source(
        kind,
        kind === 'youtube' ? 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' : 'https://fixture.invalid/episode',
        `snapshots/${randomUUID()}/source/body.html`,
        ''
      )
      item.textKey = item.key.replace('body.html', 'body.txt')
      sql(`UPDATE sr_bookmark SET content_md_key=${sqlString(item.textKey)} WHERE id=${item.id}`)
      const content = (language: 'en' | 'zh'): YoutubeArticleDocument => ({
        schema_version: 1,
        language,
        format: 'article',
        lede: `${kind} ${language} saved article`,
        sections: [{ heading: 'One', start_ms: 5000, end_ms: 10000, paragraphs: [{ text: 'Saved paragraph', speaker: null, source_cue_ids: ['c1'] }] }]
      })
      const player: PodcastPlayerInfo = {
        language: 'en',
        audioUrl: 'https://fixture.invalid/audio.mp3',
        title: 'Saved episode',
        showName: 'Saved show',
        shownotes: '',
        coverUrl: '',
        durationSec: 60
      }
      const cues = [{ id: 'c1', start_ms: 5000, duration_ms: 5000, text: 'Saved paragraph' }]
      const media = {
        schema: 1,
        kind,
        mode: 'capture',
        revision: 'source',
        sourceId: kind === 'youtube' ? 'dQw4w9WgXcQ' : 'episode',
        sourceHash: 'saved-hash',
        inputFingerprint: 'saved-input',
        defaultLanguage: 'en',
        transcript: 'ready',
        bodyLanguage: 'en',
        cues,
        variants: {
          en: { status: 'ready', content: normalizedMediaContent(content('en'), cues) },
          zh: kind === 'podcast' ? { status: 'ready', content: normalizedMediaContent(content('zh'), cues) } : { status: 'pending' }
        },
        ...(kind === 'podcast' ? { player } : {})
      }
      const body =
        kind === 'podcast'
          ? renderPodcastBody({ info: player, article: { doc: content('en'), version: 'source-en', cues } })
          : `<youtube-player data-video-id="dQw4w9WgXcQ" data-cues="[{&quot;t&quot;:5,&quot;text&quot;:&quot;Saved paragraph&quot;}]"></youtube-player>\n${renderMediaArticle(content('en'), 'source-en', cues, 'youtube')}`
      await bucket.put(item.key, body)
      await bucket.put(item.textKey, `${kind} saved body`)
      await bucket.put(item.key.replace('body.html', 'media.json'), JSON.stringify(media))
      sql(
        `INSERT INTO sr_youtube_article_ref(bookmark_id,user_id,media_kind,video_id,source_hash,updated_at) VALUES(${item.id},2,${sqlString(kind)},${sqlString(media.sourceId)},'saved-hash',now())`
      )
    }
    return {
      dispose: () => proxy.dispose(),
      sources,
      async exercise(fetch: (path: string, init?: RequestInit) => Promise<Response>, headers: Record<string, string>, readerOrigin: string) {
        const call = async (path: string, body?: unknown, asGuest = false) => {
          const response = await fetch(path, { headers: asGuest ? {} : headers, ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}) })
          const result = (await response.json()) as any
          return { response, result }
        }
        const saved: Record<string, any> = {}
        for (const [name, src] of Object.entries(sources)) {
          const { response, result } = await call('/v1/bookmark/fork', { source_user_bookmark_uuid: src.uuid })
          assert.equal(response.status, 200, `${name}: ${JSON.stringify(result)}`)
          assert.equal(result.data.disposition, 'created')
          assert.match(response.headers.get('cache-control') || '', /no-store/)
          const dest = json(
            `SELECT ub.uuid,ub.bookmark_id,ub.forked_from_id,ub.is_starred,ub.alias_title,b.private_user,b.target_url,b.content_key,b.content_md_key FROM sr_user_bookmark ub JOIN sr_bookmark b ON b.id=ub.bookmark_id WHERE ub.uuid=${sqlString(result.data.bookmark_uid)}`
          )
          assert.equal(dest.private_user, 1)
          assert.equal(dest.is_starred, false)
          assert.equal(dest.alias_title, '')
          assert.equal(Number(sql(`SELECT id FROM sr_user_bookmark WHERE uuid=${sqlString(src.uuid)}`)), dest.forked_from_id)
          if (src.key) {
            assert.notEqual(dest.content_key, src.key)
            assert.equal(
              await (await bucket.get(dest.content_key))!.arrayBuffer().then(b => Buffer.from(b).toString('base64')),
              await (await bucket.get(src.key))!.arrayBuffer().then(b => Buffer.from(b).toString('base64'))
            )
          }
          saved[name] = dest
          const duplicate = await call('/v1/bookmark/fork', { source_user_bookmark_uuid: src.uuid })
          assert.equal(duplicate.result.data.bookmark_uid, dest.uuid)
          assert.equal(duplicate.result.data.disposition, 'already_saved')
        }
        assert.equal(saved.uploadedPdf.target_url, `slax-pdf://1/${digest}`)
        assert.equal(await (await bucket.get(saved.html.content_md_key))!.text(), 'Independent articleOriginal source body.')
        // A cached search made while trashed must not hide either form of restored save.
        for (const sourceUuid of [html.uuid, saved.html.uuid]) {
          sql(`UPDATE sr_user_bookmark SET deleted_at=now() WHERE uuid=${sqlString(saved.html.uuid)}`)
          await proxy.env.KV.put('search:valid_bm_ids:1', '[]')
          const restored = await call('/v1/bookmark/fork', {
            source_user_bookmark_uuid: sourceUuid
          })
          assert.equal(restored.result.data.bookmark_uid, saved.html.uuid)
          assert.equal(restored.result.data.disposition, 'already_saved')
          assert.equal(sql(`SELECT deleted_at IS NULL FROM sr_user_bookmark WHERE uuid=${sqlString(saved.html.uuid)}`), 't')
          assert.equal(await proxy.env.KV.get('search:valid_bm_ids:1'), null)
        }
        const recoverySources: Source[] = []
        for (const [kind, preserveTranscript, scenario] of [
          ['youtube', false, 'catchup'],
          ['youtube', false, 'disabled'],
          ['youtube', false, 'language'],
          ['youtube', false, 'eligible'],
          ['podcast', false, 'changed'],
          ['podcast', true, 'changed'],
          ['podcast', false, 'duration-null'],
          ['podcast', false, 'duration-estimate']
        ] as const) {
          const name = kind === 'youtube' ? `dQw4w9WgXc${['catchup', 'disabled', 'language', 'eligible'].indexOf(scenario)}` : `${kind}-recovery-${preserveTranscript}-${scenario}`
          const item = source(name, `https://fixture.invalid/${name}`, `snapshots/${randomUUID()}/pending/body.html`, '')
          delete sources[name]
          recoverySources.push(item)
          item.textKey = item.key.replace('body.html', 'body.txt')
          sql(
            `UPDATE sr_bookmark SET private_user=1,content_md_key=${sqlString(item.textKey)} WHERE id=${item.id}; UPDATE sr_user_bookmark SET user_id=1 WHERE bookmark_id=${
              item.id
            }`
          )
          const episode = {
            audio_url: 'https://fixture.invalid/retry.mp3',
            title: 'Before refresh',
            show_name: 'Show',
            shownotes: '',
            duration_sec: scenario === 'duration-null' ? null : 60,
            publisher_transcripts: []
          }
          const media = {
            schema: 1,
            kind,
            mode: 'capture',
            revision: 'pending',
            sourceId: name,
            sourceHash: kind === 'youtube' ? 'retry-hash' : '',
            inputFingerprint: kind === 'youtube' ? 'retry-hash' : await podcastInputFingerprint(episode),
            defaultLanguage: 'en',
            transcript: kind === 'youtube' || preserveTranscript ? 'ready' : 'pending',
            bodyLanguage: null,
            variants: { en: { status: 'pending' } },
            ...(preserveTranscript ? { cues: [{ id: 'c1', start_ms: 100, duration_ms: 1000, text: 'Saved transcript' }] } : {}),
            ...(kind === 'podcast'
              ? {
                  player: {
                    audioUrl: episode.audio_url,
                    title: episode.title,
                    showName: 'Show',
                    shownotes: '',
                    coverUrl: '',
                    durationSec: episode.duration_sec,
                    language: 'en'
                  }
                }
              : {})
          }
          await bucket.put(item.key, '<article>Saved pending body</article>')
          await bucket.put(item.textKey, 'Saved pending body')
          await bucket.put(item.key.replace('body.html', 'media.json'), JSON.stringify(media))
          sql(
            `INSERT INTO sr_youtube_article_ref(bookmark_id,user_id,media_kind,video_id,source_hash,updated_at) VALUES(${
              item.id
            },1,${sqlString(kind)},${sqlString(name)},${sqlString(media.sourceHash)},now())`
          )
          sql(
            `INSERT INTO sr_youtube_article(media_kind,video_id,source_hash,target_language,status,article_key,prompt_version,updated_at) VALUES(${sqlString(
              kind
            )},${sqlString(name)},'retry-hash','en','ready',${sqlString(`canonical/${name}.json`)},'v1',now())`
          )
          if (kind === 'youtube' && scenario === 'catchup') {
            // The private manifest exists; only the canonical catch-up artifact is unavailable.
            const status = await call(`/v1/youtube_article/status?bookmark_uid=${item.uuid}`)
            assert.equal(status.response.status, 200)
            assert.equal(status.result.code, 200)
            assert.equal(status.result.data.status, 'pending')
            assert.equal(sql(`SELECT content_key FROM sr_bookmark WHERE id=${item.id}`), item.key)
          } else if (kind === 'youtube') {
            await bucket.put(
              `canonical/${name}.json`,
              JSON.stringify({
                schema_version: 1,
                language: 'en',
                format: 'article',
                lede: 'Ready YouTube supplement',
                sections: [{ heading: 'One', start_ms: 0, end_ms: 1000, paragraphs: [{ text: 'Ready paragraph', speaker: null, source_cue_ids: ['c1'] }] }]
              })
            )
            await bucket.put(`canonical/${name}-cues.json`, JSON.stringify({ cues: [{ id: 'c1', start_ms: 0, duration_ms: 1000, text: 'Ready paragraph' }] }))
            sql(`UPDATE sr_youtube_article SET caption_key=${sqlString(`canonical/${name}-cues.json`)} WHERE video_id=${sqlString(name)}`)
            sql(
              `UPDATE sr_user_lab_feature SET enabled=${scenario !== 'disabled'} WHERE user_id=1 AND feature='youtube_article'; UPDATE sr_user SET ai_lang=${sqlString(scenario === 'language' ? 'zh' : 'en')} WHERE id=1`
            )
            const status = await call(`/v1/youtube_article/status?bookmark_uid=${item.uuid}`)
            assert.equal(status.result.code, 200)
            const currentKey = sql(`SELECT content_key FROM sr_bookmark WHERE id=${item.id}`)
            const settled = await (await bucket.get(currentKey.replace('body.html', 'media.json')))!.json<any>()
            assert.equal(settled.variants.en.status, 'ready')
            assert.equal(settled.bodyLanguage, scenario === 'eligible' ? 'en' : null)
            const body = await (await bucket.get(currentKey))!.text()
            if (scenario === 'eligible') assert.match(body, /Ready YouTube supplement/)
            else assert.equal(body, '<article>Saved pending body</article>')
            sql("UPDATE sr_user_lab_feature SET enabled=true WHERE user_id=1 AND feature='youtube_article'; UPDATE sr_user SET ai_lang='en' WHERE id=1")
          } else {
            sql(
              `INSERT INTO sr_podcast_episode(source_id,audio_url,title,show_name,duration_sec,language,publisher_transcripts,transcript_status,transcript_key,transcript_hash,updated_at) VALUES(${sqlString(
                name
              )},${sqlString(episode.audio_url)},${sqlString(scenario === 'changed' ? 'After refresh' : episode.title)},'Show',${scenario === 'changed' ? 60 : 61},'en','[]','ready','canonical/retry-transcript.json','retry-hash',now())`
            )
            await bucket.put(
              'canonical/retry-transcript.json',
              JSON.stringify({
                language: 'en',
                cues: [
                  {
                    id: 'c1',
                    start_ms: 5000,
                    duration_ms: 1000,
                    text: 'Recovered body'
                  }
                ]
              })
            )
            await bucket.put(
              `canonical/${name}.json`,
              JSON.stringify({
                schema_version: 1,
                language: 'en',
                format: 'article',
                lede: 'Recovered body',
                sections: [{ heading: 'Recovery', start_ms: 0, end_ms: 6000, paragraphs: [{ text: 'Recovered paragraph', speaker: null, source_cue_ids: ['c1'] }] }]
              })
            )
            const status = await call(`/v1/podcast/status?bookmark_uid=${item.uuid}`)
            if (scenario === 'changed') {
              assert.equal(status.result.data.article, 'failed')
              assert.equal(status.result.data.reason, 'input_changed')
              assert.equal(status.result.data.can_retry, true)
              const stoppedKey = sql(`SELECT content_key FROM sr_bookmark WHERE id=${item.id}`)
              const stoppedMedia = await (await bucket.get(stoppedKey.replace('body.html', 'media.json')))!.json<any>()
              assert.equal(stoppedMedia.variants.en.status, 'unavailable')
              assert.equal(stoppedMedia.variants.en.reason, 'input_changed')
              const retry = await call('/v1/podcast/retry', { bookmark_uid: item.uuid })
              assert.equal(retry.response.status, 200)
              assert.equal(retry.result.code, 200)
              assert.equal(retry.result.data.article, 'ready')
            } else {
              // Completing the capture's own transcript enriches duration without requiring retry.
              assert.equal(status.result.data.transcript, 'ready')
              assert.equal(status.result.data.article, 'ready')
              assert.equal(status.result.data.can_retry, false)
            }
            const currentKey = sql(`SELECT content_key FROM sr_bookmark WHERE id=${item.id}`)
            assert.notEqual(currentKey, item.key)
            const recoveredBody = await (await bucket.get(currentKey))!.text()
            assert.match(recoveredBody, /Recovered body/)
            assert.match(recoveredBody, /class="slax-pod-p" data-start-ms="5000"/)
            if (preserveTranscript) {
              const recovered = await (await bucket.get(currentKey.replace('body.html', 'media.json')))!.json<any>()
              assert.equal(recovered.cues[0].start_ms, 100)
              assert.equal(recovered.player.title, 'Before refresh')
              // The caller's language can change between seeing a retry action and submitting it.
              const savedEnglish = structuredClone(recovered.variants.en)
              recovered.variants.zh = { status: 'pending' }
              await bucket.put(currentKey.replace('body.html', 'media.json'), JSON.stringify(recovered))
              sql(`UPDATE sr_podcast_episode SET title='Another refresh',transcript_status='transcribing' WHERE source_id=${sqlString(name)}`)
              await call(`/v1/podcast/status?bookmark_uid=${item.uuid}`)
              const reattached = await call('/v1/podcast/retry', { bookmark_uid: item.uuid })
              assert.equal(reattached.result.code, 200)
              assert.equal(reattached.result.data.article, 'ready')
              const reattachedKey = sql(`SELECT content_key FROM sr_bookmark WHERE id=${item.id}`)
              const reattachedMedia = await (await bucket.get(reattachedKey.replace('body.html', 'media.json')))!.json<any>()
              assert.deepEqual(reattachedMedia.variants.en, savedEnglish)
              assert.equal(reattachedMedia.variants.zh.status, 'pending')
            }
            assert.equal(sql(`SELECT content_key FROM sr_bookmark WHERE id=${saved.podcast.bookmark_id}`), saved.podcast.content_key)
          }
        }
        for (const endpoint of ['add', 'add_url']) {
          const result = await call(`/v1/bookmark/${endpoint}`, {
            target_url: `${readerOrigin}/b/${html.uuid}?view=mobile`,
            target_title: 'Reader shell',
            content: '<main>Must never become the article</main>'
          })
          assert.equal(result.response.status, 200)
          assert.equal(result.result.code, 200)
          assert.equal(sql(`SELECT count(*) FROM sr_bookmark WHERE private_user=1 AND target_url=${sqlString(html.url)}`), '1')
        }
        const visible = await call(`/v1/bookmark/fork_metadata?bookmark_uid=${saved.html.uuid}`)
        assert.equal(visible.result.data.fork.display_name, 'Owner')
        sql(`INSERT INTO sr_bookmark_share(user_id,bookmark_id,is_enable,show_userinfo) VALUES(2,${html.id},true,false)`)
        const hidden = await call(`/v1/bookmark/fork_metadata?bookmark_uid=${saved.html.uuid}`, undefined, true)
        assert.equal(hidden.result.data.fork.display_name, null)
        sql(`UPDATE sr_bookmark_share SET is_enable=false WHERE bookmark_id=${html.id}`)
        const revoked = await call('/v1/bookmark/fork', { source_user_bookmark_uuid: html.uuid })
        assert.equal(revoked.response.status, 404)
        assert.equal((await call(`/v1/bookmark/fork_metadata?bookmark_uid=${saved.html.uuid}`)).result.data.fork.status, 'unavailable')
        for (const src of [...Object.values(sources), ...recoverySources]) {
          if (src.key) await bucket.delete([src.key, src.textKey, src.key.replace('body.html', 'media.json')].filter(Boolean))
          sql(
            `DELETE FROM sr_youtube_article_ref WHERE bookmark_id=${src.id}; DELETE FROM sr_bookmark_share WHERE bookmark_id=${src.id}; DELETE FROM sr_user_bookmark WHERE bookmark_id=${src.id}; DELETE FROM sr_bookmark WHERE id=${src.id};`
          )
        }
        const body = await fetch('/v1/bookmark/content', { method: 'POST', headers, body: JSON.stringify({ bookmark_uid: saved.html.uuid }) })
        assert.match(await body.text(), /Original source body/)
        const range = await fetch(`/v1/bookmark/pdf?bookmark_uid=${saved.uploadedPdf.uuid}`, { headers: { ...headers, Range: 'bytes=0-7' } })
        assert.equal(range.status, 206)
        assert.equal(await range.text(), '%PDF-1.7')
        const youtube = await call(`/v1/youtube_article/status?bookmark_uid=${saved.youtube.uuid}`)
        assert.equal(youtube.result.data.status, 'ready')
        const article = await call(`/v1/youtube_article/content?bookmark_uid=${saved.youtube.uuid}&version=${youtube.result.data.version}`)
        assert.equal(article.result.data.lede, 'youtube en saved article')
        const manifest = await (await bucket.get(saved.podcast.content_key.replace('body.html', 'media.json')))!.json<any>()
        const translation = await call(`/v1/podcast/translation?bookmark_uid=${saved.podcast.uuid}&version=${manifest.revision}-zh`)
        assert.equal(translation.result.data.lede, 'podcast zh saved article')
        assert.equal(translation.result.data.sections[0].paragraphs[0].start_ms, 5000)
        // Remove only this fixture's records to preserve the original CRUD smoke's list-empty contract.
        for (const dest of Object.values(saved)) {
          sql(
            `DELETE FROM sr_youtube_article_ref WHERE bookmark_id=${dest.bookmark_id}; DELETE FROM sr_user_bookmark WHERE bookmark_id=${dest.bookmark_id}; DELETE FROM sr_bookmark WHERE id=${dest.bookmark_id};`
          )
        }
        return {
          formats: Object.keys(sources),
          independent: true,
          sourceDeletion: true,
          pdfRange: true,
          mediaVariants: true,
          attributionRevocation: true,
          legacyEntries: true,
          restoredSearch: true,
          catchUpFailure: true,
          podcastOwnerRecovery: true,
          podcastDurationCompletion: true,
          youtubePromotionEligibility: true
        }
      }
    }
  } catch (error) {
    await proxy.dispose()
    throw error
  }
}
