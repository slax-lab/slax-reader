// Run with Node 24: node apps/web/tests/fixtures/article-loading/benchmark.mjs
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { applyArticleImageLoading } from '../../../app/utils/articleImageLoading.ts'

const image = '<p>A</p><img src="https://fixtures.invalid/image.jpg" width="1200" height="800">'
const body = image.repeat(100)
const html = body + 'x'.repeat(100_000 - body.length)
const options = { enabled: true, excludedPresentation: false }
const samples = []
for (let iteration = 0; iteration < 105; iteration++) {
  const start = performance.now()
  applyArticleImageLoading(html, options)
  const elapsed = performance.now() - start
  if (iteration >= 5) samples.push(elapsed)
}
samples.sort((a, b) => a - b)
console.log(JSON.stringify({
  runtime: process.version,
  platform: `${process.platform}/${process.arch}`,
  bytes: Buffer.byteLength(html),
  images: 100,
  sha256: createHash('sha256').update(html).digest('hex'),
  warmup: 5,
  repeats: samples.length,
  medianMs: (samples[49] + samples[50]) / 2,
  minMs: samples[0],
  maxMs: samples[99],
  p95Ms: samples[94]
}, null, 2))
