import { test, expect, vi } from 'vitest'
import { Normalizer } from '@/utils/hybridSearch/normalizer'
const env = (response: () => Promise<Response>) => ({ SLAX_JIEBA: { idFromName: () => '', get: () => ({ fetch: response }) } }) as unknown as Env
test('strict private normalization rejects tokenizer failure without logging title/body or provider errors', async () => {
  const logs = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    const n = new Normalizer(
      env(async () => new Response('PRIVATE PROVIDER CONTENT', { status: 503 })),
      { strictPrivate: true }
    )
    await expect(n.processFulltext('PRIVATE SUBJECT', 'PRIVATE MAIL BODY')).rejects.toThrow('Private')
    expect(JSON.stringify(logs.mock.calls)).not.toContain('PRIVATE')
  } finally {
    logs.mockRestore()
  }
})
test('strict private normalization validates malformed tokens while ordinary punctuation is a valid empty normalization', async () => {
  const bad = new Normalizer(
    env(async () => Response.json({ data: [{ text: 'PRIVATE' }] })),
    { strictPrivate: true }
  )
  await expect(bad.processFulltext('title', 'content')).rejects.toThrow('Private')
  const empty = new Normalizer(
    env(async () => Response.json({ data: [] })),
    { strictPrivate: true }
  )
  expect(await empty.processFulltext('...', '!!!')).toMatchObject([{ normalized_content: '', normalized_title: '' }])
})
