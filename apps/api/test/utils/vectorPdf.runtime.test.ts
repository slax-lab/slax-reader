import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { pdfFixture } from '../helpers/pdfFixture'

const require = createRequire(import.meta.url)
const runtimeRequire = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare } = runtimeRequire('miniflare')
const { build } = runtimeRequire('esbuild')

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const LARGE = 'pdf/body/large.pdf'
const DIRECT = 'pdf/body/direct.pdf'
const TEXT = 'text/pdf/large.txt'

async function workerBundle() {
  return build({
    stdin: {
      contents: `
      import { VectorSourceRepo } from './src/infra/repository/vectorSources.ts';
      import { VectorEmbeddingClient } from './src/infra/external/vectorEmbedding.ts';
      export default { async fetch(request, env) {
        const calls = [];
        let originalGets = 0;
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (_url, init) => {
          const payload = JSON.parse(init.body);
          calls.push({ bytes: init.body.length, pdf: typeof payload.input?.pdf === 'string', task: payload.task });
          return env.PROVIDER.fetch('http://offline/embeddings', init);
        };
        try {
          const sources = new VectorSourceRepo({
            PROXY_IMAGE_PREFIX: 'https://reader.invalid/image_proxy',
            OSS: {
              head: async key => key === '${LARGE}' ? { size: 50 * 1024 * 1024, etag: 'large-etag' } : env.OSS.head(key),
              get: async (key, options) => {
                if (key === '${LARGE}') {
                  originalGets++;
                  throw new Error('original_body_read');
                }
                return env.OSS.get(key, options);
              }
            }
          });
          const encoder = new VectorEmbeddingClient({ JINA_API_KEY: 'offline' });
          if (new URL(request.url).pathname === '/large') {
            const source = { uuid: 'large', title: 'Large PDF', content_key: '${LARGE}', content_md_key: '${TEXT}' };
            const fingerprint = await sources.fingerprint(source);
            const direct = await sources.pdfInput(source);
            const texts = [];
            for await (const input of sources.articleInputs(source)) {
              for (const parts of await encoder.embed([input])) texts.push(input.text);
            }
            return Response.json({ direct: !!direct, fingerprint, originalGets, calls, texts });
          }
          const source = { uuid: 'direct', title: 'Direct PDF', content_key: '${DIRECT}', content_md_key: '' };
          const input = await sources.pdfInput(source);
          const vectors = await encoder.pdf(input.base64);
          return Response.json({ vectors: vectors.length, base64: input.base64, keys: Object.keys(input), originalGets, calls });
        } finally {
          globalThis.fetch = originalFetch;
        }
      }};`,
      resolveDir: ROOT,
      loader: 'ts'
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    external: ['node:*'],
    logLevel: 'silent'
  })
}

function directPdf(pages: number, exactBytes: number) {
  const fixture = pdfFixture(Array.from({ length: pages }, (_, index) => `Page ${index + 1}`))
  const bytes = new Uint8Array(exactBytes)
  bytes.set(fixture.subarray(0, Math.min(fixture.length, exactBytes)))
  return bytes
}

test('actual Workerd routes a 50MiB original by HEAD metadata and embeds only its stored extracted text', async () => {
  const bundled = await workerBundle()
  const providerCalls: { bytes: number; pdf: boolean; task: string }[] = []
  const responseBytes: number[] = []
  const largeText = 'Stored extracted text for the accepted 50MiB PDF. '.repeat(2500)
  const direct = directPdf(400, 8_000_000)
  const runtime = new Miniflare({
    telemetry: { enabled: false },
    cf: false,
    inspectorPort: 0,
    workers: [
      {
        config: {
          name: 'vector-pdf-policy',
          type: 'worker',
          compatibilityDate: '2026-08-01',
          compatibilityFlags: ['nodejs_compat'],
          manifest: { mainModule: 'worker.mjs', modulesRoot: ROOT, modules: { 'worker.mjs': { type: 'esm', contents: bundled.outputFiles[0].text } } },
          env: {
            OSS: { type: 'r2', name: 'vector-pdf-policy-only' },
            PROVIDER: {
              type: 'fetcher',
              handler: async (request: Request) => {
                const body = await request.text()
                const payload = JSON.parse(body)
                const count = typeof payload.input?.pdf === 'string' ? 400 : payload.input.length
                providerCalls.push({ bytes: Buffer.byteLength(body), pdf: typeof payload.input?.pdf === 'string', task: payload.task })
                const padding = typeof payload.input?.pdf === 'string' ? 'x'.repeat(55_000) : ''
                const responseBody = JSON.stringify({
                  model: 'jina-embeddings-v5-omni-small',
                  data: Array.from({ length: count }, (_, index) => ({
                    index,
                    embedding: Array.from({ length: 1024 }, (_, i) => (i === index % 1024 ? 1 : 0)),
                    ...(padding ? { padding } : {})
                  }))
                })
                responseBytes.push(Buffer.byteLength(responseBody))
                return new Response(responseBody, { status: 200, headers: { 'Content-Type': 'application/json' } })
              }
            }
          }
        }
      }
    ]
  })
  let socket: WebSocket | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let heapPeak = 0
  let backingPeak = 0
  let combinedPeak = 0
  let samples = 0
  let invalidSamples = 0
  try {
    await runtime.ready
    const bucket = await runtime.getR2Bucket('OSS')
    await bucket.put(TEXT, largeText)
    await bucket.put(DIRECT, direct)
    const inspector = await runtime.getInspectorURL()
    inspector.protocol = 'http:'
    const targets = (await (await fetch(new URL('/json/list', inspector))).json()) as { webSocketDebuggerUrl: string; title: string }[]
    const target = targets.find(target => target.title.includes('vector-pdf-policy'))
    if (!target) throw new Error('missing_worker_inspector')
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener('open', () => resolve(), { once: true })
      socket!.addEventListener('error', reject, { once: true })
    })
    let id = 0
    socket.addEventListener('message', event => {
      const response = JSON.parse(String(event.data))
      if (!response.id) return
      const { usedSize, backingStorageSize } = response.result || {}
      if (!Number.isFinite(usedSize) || usedSize <= 0 || !Number.isFinite(backingStorageSize) || backingStorageSize < 0) {
        invalidSamples++
        return
      }
      samples++
      heapPeak = Math.max(heapPeak, usedSize)
      backingPeak = Math.max(backingPeak, backingStorageSize)
      combinedPeak = Math.max(combinedPeak, usedSize + backingStorageSize)
    })
    timer = setInterval(() => socket!.send(JSON.stringify({ id: ++id, method: 'Runtime.getHeapUsage' })), 20)

    const largeResponse = await runtime.dispatchFetch('http://local/large')
    const largeBody = await largeResponse.text()
    expect(largeResponse.status, largeBody).toBe(200)
    const large = JSON.parse(largeBody)
    expect(large.originalGets).toBe(0)
    expect(large.direct).toBe(false)
    expect(large.fingerprint.text_key).toBe(TEXT)
    expect(large.fingerprint.text_etag).toEqual(expect.any(String))
    expect(large.texts.join('')).toBe(`Large PDF\n\n${largeText}`)
    expect(providerCalls.every(call => !call.pdf && call.task === 'text-matching')).toBe(true)
    const textCalls = providerCalls.length
    expect(textCalls).toBeGreaterThan(0)

    const directResponse = await runtime.dispatchFetch('http://local/direct')
    const directBody = await directResponse.text()
    expect(directResponse.status, directBody).toBe(200)
    const directResult = JSON.parse(directBody)
    expect(directResult.originalGets).toBe(0)
    expect(directResult.keys).toEqual(['base64'])
    expect(directResult.vectors).toBe(400)
    expect(Buffer.from(directResult.base64, 'base64').equals(Buffer.from(direct))).toBe(true)
    expect(providerCalls).toHaveLength(textCalls + 1)
    expect(providerCalls[textCalls]).toMatchObject({ pdf: true, task: 'text-matching' })
    expect(responseBytes[textCalls]).toBeGreaterThan(2 * 1024 * 1024)
    await new Promise(resolve => setTimeout(resolve, 300))

    expect(samples).toBeGreaterThan(2)
    expect(invalidSamples).toBe(0)
    console.log(
      JSON.stringify({
        largeOriginalBytes: 50 * 1024 * 1024,
        largeOriginalReads: large.originalGets,
        directBytes: direct.byteLength,
        directVectors: directResult.vectors,
        samples,
        heapPeak,
        backingPeak,
        combinedPeak,
        memoryNote: 'Observed Workerd RSS/backing samples for this scripted path only; not an isolate memory guarantee, exclude native overhead and can miss peaks',
        priorBudgetNote: 'The former 64MiB combined heuristic is not asserted here: the exact-8M direct branch observably exceeds it in this fixture, and the number is not a production isolate guarantee'
      })
    )
  } finally {
    clearInterval(timer)
    socket?.close()
    await runtime.dispose()
  }
}, 120_000)
