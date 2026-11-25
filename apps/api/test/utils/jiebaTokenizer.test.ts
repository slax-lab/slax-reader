import { readFile } from 'node:fs/promises'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { cut_for_search, initSync } from '@/utils/wasmJieba/jieba_rs_wasm.js'
import { SlaxJieba } from '@/utils/hybridSearch/jieba'

vi.mock('@/utils/wasmJieba/jieba_rs_wasm_bg.wasm', async () => {
  const { readFile } = await import('node:fs/promises')
  return { default: await WebAssembly.compile(await readFile(new URL('../../src/utils/wasmJieba/jieba_rs_wasm_bg.wasm', import.meta.url))) }
})

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }))

const jieba = new SlaxJieba({} as never, {} as never)

async function cut(text: string, hmm?: boolean): Promise<string[]> {
  const res = await jieba.fetch(new Request('http://cut_for_search', { method: 'POST', body: JSON.stringify({ text, hmm }) }))
  expect(res.status).toBe(200)
  return ((await res.json()) as { data: string[] }).data
}

const pieces = ['人工智能的发展趋势', '😀', '\r\n', ' ', 'cloudflare-worker_v2.1', '𠀀𠀁𪚥', '，', 'C++#', 'https://example.com/a?b=1&c=2', '\t', 'ÀÉ', '向量数据库原理', '\n\n']
const mixed = Array.from({ length: 12000 }, (_, i) => pieces[(i * 7) % pieces.length]).join('')
const longRun = 'QUJD'.repeat(20000)

beforeAll(async () => {
  initSync({ module: await WebAssembly.compile(await readFile(new URL('../../src/utils/wasmJieba/jieba_rs_wasm_bg.wasm', import.meta.url))) })
})

describe('SlaxJieba cut_for_search', () => {
  test('cuts a short query', async () => {
    expect(await cut('读书笔记方法', true)).toEqual(['读书', '笔记', '读书笔记', '方法'])
  })

  test.each([
    ['mixed scripts, emoji, CRLF and astral Han', mixed],
    ['one run longer than a chunk', longRun],
    ['both', mixed + longRun + mixed]
  ])('a long document cut in chunks matches one call on the whole text: %s', async (_name, text) => {
    expect(text.length).toBeGreaterThan(32 * 1024)
    expect(await cut(text)).toEqual(cut_for_search(text))
    expect(await cut(text, true)).toEqual(cut_for_search(text, true))
  })

  test('concurrent long documents and queries each get their own tokens', async () => {
    const [a, query, b] = await Promise.all([cut(mixed), cut('向量数据库原理', true), cut(longRun + mixed)])
    expect(a).toEqual(cut_for_search(mixed))
    expect(query).toEqual(['向量', '数据', '据库', '数据库', '原理'])
    expect(b).toEqual(cut_for_search(longRun + mixed))
  })

  test('rejects an empty text and other operations', async () => {
    expect((await jieba.fetch(new Request('http://cut_for_search', { method: 'POST', body: JSON.stringify({ text: '' }) }))).status).toBe(400)
    expect((await jieba.fetch(new Request('http://cut', { method: 'POST', body: JSON.stringify({ text: '读书' }) }))).status).toBe(404)
  })
})
