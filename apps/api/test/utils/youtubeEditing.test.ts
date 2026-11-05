import { describe, expect, it, vi } from 'vitest'
import { renderSourcePassages, sourcePassages, type SourcePassage } from '@/utils/youtubeEditing'

const passages: SourcePassage[] = [
  { key: 'p0', text: 'Welcome. Thanks for having me.', ids: ['c0012', 'c0013', 'c0014'] },
  { key: 'p1', text: 'That sounds great. Does that work? My balance was -50.', ids: ['c0020', 'c0021'] }
]
const batch = async (items: SourcePassage[], run: (items: SourcePassage[]) => Promise<void>) => run(items)

function store() {
  const data = new Map<string, string>()
  return {
    get: async (key: string) => (data.has(key) ? { text: async () => data.get(key)! } : null),
    put: async (key: string, value: string) => {
      data.set(key, value)
    }
  } as unknown as Pick<R2Bucket, 'get' | 'put'>
}

describe('source-owned YouTube passages', () => {
  it('partitions short and long cues once, in input order, even with gaps in cue numbering', () => {
    const cues = Array.from({ length: 160 }, (_, i) => ({ id: 'c' + 2 * i, start_ms: i, text: '>> One more question.' }))
    const planned = sourcePassages(cues)
    expect(planned.length).toBeGreaterThan(1)
    expect(planned.flatMap(p => p.ids)).toEqual(cues.map(c => c.id))
    expect(planned.map(p => p.text).join(' ')).toBe(cues.map(c => c.text).join(' '))
  })

  it.each(['That sounds great. My balance was -50.', 'Does that work? That sounds great. My balance was -50.', passages[1].text.replace('-50', '50')])(
    'restores source for a missing, moved or numerically changed passage: %s',
    async edit => {
      const report = vi.fn()
      const sections = await renderSourcePassages(
        passages,
        'en',
        'en',
        'chunk',
        store(),
        batch,
        async () =>
          JSON.stringify({
            p1: { heading: '', text: edit },
            p0: { heading: 'Greetings', text: 'Welcome! Thanks for having me.' }
          }),
        report
      )
      expect(sections[0].paragraphs.map(p => p.text)).toEqual(['Welcome! Thanks for having me.', passages[1].text])
      expect(sections[0].paragraphs.flatMap(p => p.source_cue_ids)).toEqual(passages.flatMap(p => p.ids))
      expect(report).toHaveBeenCalledWith('source_fallback', 1)
    }
  )

  it('recovers partial translations and a timed-out retry from persisted work', async () => {
    const bucket = store()
    const generate = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(Object.fromEntries(passages.map(p => [p.key, { heading: p.key === 'p0' ? 'Greetings' : '', text: p.text }]))))
      .mockResolvedValueOnce(JSON.stringify({ p0: { heading: '问候', text: '欢迎。谢谢邀请。' } }))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(JSON.stringify({ p1: { heading: '', text: '听起来不错。可以吗？余额是 -50。' } }))
    const run = () => renderSourcePassages(passages, 'en', 'zh', 'chunk', bucket, batch, generate, vi.fn())
    await expect(run()).rejects.toThrow('translation_missing_passages')
    await expect(run()).rejects.toThrow('timeout')
    const sections = await run()
    expect(generate.mock.calls.map(c => c[2])).toEqual([['p0', 'p1'], ['p0', 'p1'], ['p1'], ['p1']])
    expect(sections[0].paragraphs.map(p => p.source_cue_ids)).toEqual(passages.map(p => p.ids))
    expect(await run()).toEqual(sections)
    expect(generate).toHaveBeenCalledTimes(4)
  })
})
