/** Controlled HTTP model exercise. This measures scheduling, not provider latency or language quality. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { runYoutubeArticle, type RunnerDeps, type StepLike } from '../../src/domain/youtubeArticleRunner'
import { buildYoutubeCaptionDocument } from '../../src/utils/youtubeCaption'

const videoId = 'dQw4w9WgXcQ'
const sourceHash = 'a'.repeat(64)
const captionKey = 'caption.json'
const caption = buildYoutubeCaptionDocument(
  videoId,
  { language_code: 'en', language_name: 'English', kind: '', is_translatable: true, base_url: '' },
  Array.from({ length: 650 }, (_, i) => ({
    tStartMs: i * 6000,
    dDurationMs: 5800,
    segs: [{ utf8: `Attention connects every token with the other tokens in the sequence and preserves the complete source order for example number ${i}.` }]
  }))
)
let active = 0
let peak = 0
const server = createServer(async (request, response) => {
  let body = ''
  for await (const part of request) body += part
  const { user, system } = JSON.parse(body)
  active++
  peak = Math.max(peak, active)
  await new Promise(resolve => setTimeout(resolve, 80))
  const overlap = Number(/the first (\d+) cues were already covered/.exec(system)?.[1] ?? 0)
  const cues = [...user.matchAll(/^(c\d{4}) \[[^\]]+\] (.*)$/gm)].slice(overlap)
  const paragraphs = []
  for (let i = 0; i < cues.length; i += 3) {
    const group = cues.slice(i, i + 3)
    paragraphs.push({ speaker: null, text: group.map(c => c[2]).join(' '), source_cue_ids: group.map(c => c[1]) })
  }
  active--
  response.setHeader('Content-Type', 'application/json')
  response.end(
    JSON.stringify({
      text: JSON.stringify({ lede: system.includes('Start with') ? 'This transcript explains attention.' : '', sections: [{ heading: 'Attention', paragraphs }] }),
      usage: { inputTokens: 3000, outputTokens: 3000 },
      finishReason: 'STOP'
    })
  )
})
async function main() {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  async function exercise(serial: boolean) {
    peak = 0
    const objects = new Map([[captionKey, JSON.stringify(caption)]])
    const row = { id: 1, source_hash: sourceHash, target_language: 'en', caption_key: captionKey, run_id: 'smoke', status: 'generating', cost_usd: 0, lifetime_cost_usd: 0 }
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
        publish: async () => true,
        finishAttempt: async () => {
          throw new Error('Unexpected failure')
        }
      },
      bucket: {
        get: async (key: string) => (objects.has(key) ? { text: async () => objects.get(key)! } : null),
        put: async (key: string, value: string) => {
          objects.set(key, value)
        },
        head: async (key: string) => (objects.has(key) ? { key } : null),
        delete: async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key)
        },
        list: async ({ prefix }: { prefix: string }) => ({ objects: [...objects.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })), truncated: false })
      } as any,
      model: {
        chat: async (contents, config, options) => {
          const response = await fetch(`http://127.0.0.1:${address.port}`, {
            method: 'POST',
            signal: config.abortSignal,
            body: JSON.stringify({ user: contents[0].parts![0].text, system: options.systemInstruction })
          })
          return response.json()
        }
      },
      addCost: async () => {},
      publishBodies: async () => 1,
      settleSnapshots: async () => 0
    }
    let tail: Promise<unknown> = Promise.resolve()
    const step: StepLike = {
      do: (_name, _config, fn) => {
        if (!serial) return fn()
        const result = tail.then(fn)
        tail = result
        return result
      }
    }
    const started = performance.now()
    assert.equal(
      await runYoutubeArticle(deps, { articleId: 1, videoId, sourceHash, targetLanguage: 'en', promptVersion: 'v1', title: 'Attention', trigger: 'open' }, step, 'smoke'),
      'ready'
    )
    const elapsed = Math.round(performance.now() - started)
    const key = [...objects.keys()].find(key => key.includes('/articles/') && key.endsWith('.json'))!
    const doc = JSON.parse(objects.get(key)!)
    const ids = doc.sections.flatMap((section: any) => section.paragraphs.flatMap((p: any) => p.source_cue_ids))
    assert.deepEqual(
      ids,
      caption.cues.map(cue => cue.id)
    )
    assert.equal(peak, serial ? 1 : 5)
    return { mode: serial ? 'serialized steps' : 'five concurrent chunks', elapsed_ms: elapsed, peak_calls: peak, cues: ids.length, cost_usd: row.cost_usd }
  }
  try {
    const serial = await exercise(true)
    const concurrent = await exercise(false)
    assert.ok(concurrent.elapsed_ms < serial.elapsed_ms)
    console.log(JSON.stringify({ controlled_http_model: true, serial, concurrent }))
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
  }
}
void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
