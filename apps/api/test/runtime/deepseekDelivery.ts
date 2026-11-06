/** Local HTTP protocol and delivery exercise; --live requires operator-injected credentials. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { DeepSeekClient } from '../../src/infra/external/deepseekClient'
import { runYoutubeArticle, type RunnerDeps, type StepLike } from '../../src/domain/youtubeArticleRunner'
import { planYoutubeArticle } from '../../src/utils/youtubeArticle'
import type { YoutubeCaptionDocument } from '../../src/utils/youtubeCaption'

async function main() {
  const live = process.argv.includes('--live')
  const faults = process.argv.includes('--faults')
  const files = process.argv.slice(2).filter(arg => !['--live', '--faults'].includes(arg))
  if (!files.length) throw new Error('Pass public caption JSON paths; optionally --live')
  if (live && !process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY must be injected by the operator')
  let calls = 0,
    active = 0,
    peak = 0
  const originalFetch = globalThis.fetch
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const bytes of req) raw += bytes
    const request = JSON.parse(raw)
    assert.equal(request.model, 'deepseek-flash')
    assert.deepEqual(request.thinking, { type: 'disabled' })
    assert.deepEqual(request.response_format, { type: 'json_object' })
    calls++
    active++
    peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 20))
    const system = request.messages[0].content as string
    const input = request.messages[1].content as string
    const output = system.startsWith('Write a factual')
      ? { lede: 'This is a controlled protocol exercise, not a model-quality result.' }
      : Object.fromEntries(
          Object.entries(JSON.parse(input.split('\nPrevious source context')[0]) as Record<string, { text: string }>).map(([key, value]) => [
            key,
            { text: value.text, heading: '' }
          ])
        )
    active--
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100 } }))
  })
  if (!live) {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    globalThis.fetch = (input, init) => {
      assert.equal(String(input), 'https://api.deepseek.com/chat/completions')
      return originalFetch(`http://127.0.0.1:${port}/chat/completions`, init)
    }
  }
  const injected: string[] = []
  const routedFetch = globalThis.fetch
  if (faults)
    globalThis.fetch = async (input, init) => {
      if (!injected.includes('429')) {
        injected.push('429')
        return new Response('', { status: 429 })
      }
      const response = await routedFetch(input, init)
      const fault = !injected.includes('empty') ? 'empty' : !injected.includes('truncated') ? 'truncated' : null
      if (response.ok && fault) {
        injected.push(fault)
        const body: any = await response.json()
        if (fault === 'empty') body.choices[0].message.content = ''
        else body.choices[0].finish_reason = 'length'
        return Response.json(body)
      }
      return response
    }
  try {
    for (const file of files) {
      calls = active = peak = 0
      injected.length = 0
      const caption = JSON.parse(await readFile(file, 'utf8')) as YoutubeCaptionDocument
      const hash = createHash('sha256').update(JSON.stringify(caption)).digest('hex')
      const dir = `/tmp/slax-deepseek-delivery/${hash.slice(0, 12)}-${live ? 'live' : 'protocol'}-${Date.now()}`
      await mkdir(dir, { recursive: true })
      const keys = new Set<string>()
      const filename = (key: string) => join(dir, encodeURIComponent(key))
      const put = async (key: string, value: string) => {
        if (faults && key.includes('/articles/') && key.endsWith('.json') && !injected.includes('storage')) {
          injected.push('storage')
          throw new Error('injected storage failure')
        }
        await writeFile(filename(key), value)
        keys.add(key)
        return { key }
      }
      await put('caption.json', JSON.stringify(caption))
      const language = live ? 'zh' : 'en'
      const row = { source_hash: hash, target_language: language, caption_key: 'caption.json', run_id: 'local', status: 'generating', cost_usd: 0, lifetime_cost_usd: 0 }
      const events: string[] = []
      let articleKey = ''
      const deps: RunnerDeps = {
        repo: {
          claim: async () => true,
          findById: async () => ({ ...row }) as any,
          renewLease: async (_id, _run, _lease, status) => {
            row.status = status ?? 'generating'
            return true
          },
          addCost: async (_id, cost) => {
            row.lifetime_cost_usd += cost
            return (row.cost_usd += cost)
          },
          publish: async (_id, _run, _hash, _language, data) => {
            articleKey = data.article_key
            row.status = 'ready'
            return true
          },
          finishAttempt: async (_id, result) => {
            row.status = result.kind === 'retry' ? 'pending' : result.kind
            return row.status as any
          }
        },
        bucket: {
          get: async (key: string) => (keys.has(key) ? { text: () => readFile(filename(key), 'utf8') } : null),
          put,
          head: async (key: string) => (keys.has(key) ? { key } : null),
          delete: async (input: string | string[]) => {
            for (const key of [input].flat()) {
              await rm(filename(key), { force: true })
              keys.delete(key)
            }
          },
          list: async ({ prefix }: { prefix: string }) => ({ objects: [...keys].filter(key => key.startsWith(prefix)).map(key => ({ key })), truncated: false })
        } as any,
        model: new DeepSeekClient(live ? process.env : { DEEPSEEK_API_KEY: 'local-protocol-fixture' }),
        addCost: async cost => {
          assert.ok(Number.isFinite(cost) && cost >= 0)
        },
        publishBodies: async () => {
          if (faults && !injected.includes('publication')) {
            injected.push('publication')
            throw new Error('injected body publication failure')
          }
          assert.equal(row.status, 'ready')
          const htmlKey = articleKey.replace(/\.json$/, '.html')
          await put('bookmark.html', await readFile(filename(htmlKey), 'utf8'))
          events.push('body')
          return 1
        },
        indexBodies: async () => {
          if (faults && !injected.includes('indexing')) {
            injected.push('indexing')
            throw new Error('injected indexing failure')
          }
          assert.deepEqual(events, ['body'])
          await put('search-index.txt', await readFile(filename(articleKey.replace(/\.json$/, '.txt')), 'utf8'))
          events.push('index')
          return 1
        },
        settleSnapshots: async () => 0
      }
      const steps: string[] = []
      const step: StepLike = {
        do: async (name, config, fn) => {
          steps.push(name)
          for (let attempt = 0; ; attempt++) {
            try {
              return await fn()
            } catch (error) {
              if ((error instanceof Error && error.name === 'YoutubeArticleStop') || attempt >= (config.retries?.limit ?? 0)) throw error
            }
          }
        }
      }
      const started = performance.now()
      const outcome = await runYoutubeArticle(
        deps,
        { articleId: 1, videoId: caption.video_id, sourceHash: hash, targetLanguage: language, promptVersion: 'v2', title: caption.video_id, trigger: 'open' },
        step,
        'local'
      )
      assert.equal(outcome, 'ready')
      const article = JSON.parse(await readFile(filename(articleKey), 'utf8'))
      const ids = article.sections.flatMap((s: any) => s.paragraphs.flatMap((p: any) => p.source_cue_ids))
      const plan = planYoutubeArticle(caption)
      assert.ok(plan.ok)
      assert.deepEqual(
        ids,
        plan.plan.cues.map(cue => cue.id)
      )
      assert.deepEqual(events, ['body', 'index'])
      assert.ok(steps.indexOf('publish-body') < steps.indexOf('index-bodies'))
      assert.ok(steps.indexOf('index-bodies') < steps.indexOf('drop-chunks'))
      const result = {
        injected_failures: [...injected],
        mode: live ? 'live-provider-local-runner' : 'controlled-http-local-runner',
        video_id: caption.video_id,
        outcome,
        elapsed_ms: Math.round(performance.now() - started),
        cues: ids.length,
        chunks: plan.plan.chunks.length,
        paragraphs: article.sections.reduce((n: number, s: any) => n + s.paragraphs.length, 0),
        calls: live ? undefined : calls,
        peak_calls: live ? undefined : peak,
        estimated_cost_usd: row.cost_usd,
        artifacts: dir
      }
      if (faults) assert.deepEqual([...injected].sort(), ['429', 'empty', 'truncated', 'storage', 'publication', 'indexing'].sort())
      await writeFile(join(dir, 'result.json'), JSON.stringify(result, null, 2))
      console.log(JSON.stringify(result))
    }
  } finally {
    globalThis.fetch = originalFetch
    if (!live) await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
  }
}
void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
