import { describe, expect, it, vi } from 'vitest'
import { ArticleModelError, ChunkTruncated, pendingPassageText, readPassageProgress, renderSourcePassages, sourcePassages, type SourcePassage } from '@/utils/youtubeEditing'

const passages: SourcePassage[] = [
  { key: 'p0', text: 'Welcome. Thanks for having me.', ids: ['c0012', 'c0013', 'c0014'] },
  { key: 'p1', text: 'That sounds great. Does that work? My balance was -50.', ids: ['c0020', 'c0021'] }
]
const translations = ['欢迎，谢谢邀请。', '听起来很好。可以吗？我的余额是 -50。']

function store() {
  const data = new Map<string, string>()
  return {
    data,
    get: async (key: string) => (data.has(key) ? { text: async () => data.get(key)! } : null),
    put: vi.fn(async (key: string, value: string) => {
      data.set(key, value)
    })
  }
}

describe('source-owned passages', () => {
  it('owns every cue once while cleaning speech markers without removing ordinary letters', () => {
    const cues = Array.from({ length: 160 }, (_, i) => ({ id: 'c' + 2 * i, start_ms: i, text: '>> One more question. [Music]' }))
    const planned = sourcePassages(cues)
    expect(planned.length).toBeGreaterThan(1)
    expect(planned.flatMap(p => p.ids)).toEqual(cues.map(c => c.id))
    expect(planned.map(p => p.text).join(' ')).toBe(cues.map(() => 'One more question.').join(' '))
  })

  it('keeps named turns and clears the name on an anonymous turn', () => {
    const cues = ['[Alice]: First?', 'And another?', '>> Bob: Certainly.', 'Bob: Yes.', '>> Thanks.'].map((text, i) => ({ id: 'c' + i, start_ms: i, text }))
    expect(sourcePassages(cues).map(p => [p.text, p.speaker, p.ids])).toEqual([
      ['First? And another?', 'Alice', ['c0', 'c1']],
      ['Certainly. Yes.', 'Bob', ['c2', 'c3']],
      ['Thanks.', undefined, ['c4']]
    ])
  })

  it('carries an explicitly named turn across chunk boundaries until an anonymous marker resets it', () => {
    const prior = [{ id: 'c0', start_ms: 0, text: '[Alice]: Start of a long reply.' }]
    const next = [{ id: 'c1', start_ms: 1, text: 'The reply continues.' }]
    expect(sourcePassages(next, prior)[0].speaker).toBe('Alice')
    expect(sourcePassages(next, [...prior, { id: 'c2', start_ms: 2, text: '>> An anonymous reply.' }])[0].speaker).toBeUndefined()
  })

  it('repairs missing or invalid passages using feedback without regenerating accepted passages', async () => {
    const bucket = store()
    const generate = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ p0: { text: translations[0] }, p1: { text: '' } }))
      .mockResolvedValueOnce(JSON.stringify({ p1: { text: translations[1] } }))
    const result = await renderSourcePassages(passages, 'en', 'zh', 'chunk', bucket as any, 'run', generate, vi.fn())
    expect(generate.mock.calls.map(c => c[2])).toEqual([['p0', 'p1'], ['p1']])
    expect(JSON.parse(generate.mock.calls[1][1]).p1).toMatchObject({ repair: 'missing', previous: '' })
    expect(result[0].heading).toBeTruthy()
    expect(result.flatMap(s => s.paragraphs.map(p => p.text))).toEqual(translations)
    expect(result.flatMap(s => s.paragraphs.flatMap(p => p.source_cue_ids))).toEqual(passages.flatMap(p => p.ids))
  })

  it('persists partial success before a timeout and resumes only missing work after restart', async () => {
    const bucket = store()
    const generate = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ p0: { text: translations[0] } }))
      .mockRejectedValueOnce(new ArticleModelError())
      .mockResolvedValueOnce(JSON.stringify({ p1: { text: translations[1] } }))
    const run = () => renderSourcePassages(passages, 'en', 'zh', 'chunk', bucket as any, 'run', generate, vi.fn())
    await expect(run()).rejects.toThrow('model_request_failed')
    const progress = await readPassageProgress(passages, 'chunk', bucket as any, 'run')
    expect(pendingPassageText(progress)).toEqual([passages[1].text])
    expect((await run())[0].paragraphs.map(p => p.text)).toEqual(translations)
    await run()
    expect(generate.mock.calls.map(c => c[2])).toEqual([['p0', 'p1'], ['p1'], ['p1']])
  })

  it('bounds bad content to initial, feedback and single requests; another run retains accepted work', async () => {
    const bucket = store()
    const generate = vi.fn().mockResolvedValue(JSON.stringify({ p0: { text: translations[0] } }))
    const run = (id = 'run') => renderSourcePassages(passages, 'en', 'zh', 'chunk', bucket as any, id, generate, vi.fn())
    await expect(run()).rejects.toThrow('passage_repair_exhausted')
    expect(generate.mock.calls.map(c => c[2])).toEqual([['p0', 'p1'], ['p1'], ['p1']])
    await expect(run()).rejects.toThrow('passage_repair_exhausted')
    expect(generate).toHaveBeenCalledTimes(3)
    generate.mockResolvedValue(JSON.stringify({ p1: { text: translations[1] } }))
    await run('new-run')
    expect(generate.mock.calls.at(-1)![2]).toEqual(['p1'])
  })

  it('repairs malformed JSON instead of treating untranslated source as a translation', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce('not json')
      .mockResolvedValue(JSON.stringify({ p0: { text: translations[0] }, p1: { text: translations[1] } }))
    await renderSourcePassages(passages, 'en', 'zh', 'chunk', store() as any, 'run', generate, vi.fn())
    expect(generate).toHaveBeenCalledTimes(3)
    expect(JSON.parse(generate.mock.calls[1][1]).p0.repair).toBe('missing')
  })

  it('splits a truncated passage by sentences, persists a completed child and rejoins its references', async () => {
    const source = [{ key: 'p0', text: 'We are ready. Please start.', ids: ['c0', 'c1'] }]
    const bucket = store()
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new ChunkTruncated())
      .mockResolvedValueOnce(JSON.stringify({ 'p0.0': { text: '我们准备好了。' } }))
      .mockRejectedValueOnce(new ArticleModelError())
      .mockResolvedValueOnce(JSON.stringify({ 'p0.1': { text: '请开始。' } }))
    const run = () => renderSourcePassages(source, 'en', 'zh', 'chunk', bucket as any, 'run', generate, vi.fn())
    await expect(run()).rejects.toThrow('model_request_failed')
    const result = await run()
    expect(generate.mock.calls.map(c => c[2])).toEqual([['p0'], ['p0.0'], ['p0.1'], ['p0.1']])
    expect(result[0].paragraphs[0]).toMatchObject({ text: '我们准备好了。 请开始。', source_cue_ids: ['c0', 'c1'] })
  })

  it('stops a single unsplittable truncated passage and retains completed siblings', async () => {
    const bucket = store()
    const source = [{ key: 'p0', text: 'Welcome', ids: ['c0'] }]
    const generate = vi.fn().mockRejectedValue(new ChunkTruncated())
    await expect(renderSourcePassages(source, 'en', 'zh', 'chunk', bucket as any, 'run', generate, vi.fn())).rejects.toThrow('passage_repair_exhausted')
    expect(generate).toHaveBeenCalledTimes(1)
    expect(bucket.data.has('chunk.passages')).toBe(true)
  })

  it.each([new ArticleModelError(), new ChunkTruncated()])('falls back on optional same-language request failure', async error => {
    const result = await renderSourcePassages(
      passages,
      'en',
      'en',
      'chunk',
      store() as any,
      'run',
      async () => {
        throw error
      },
      vi.fn()
    )
    expect(result.flatMap(s => s.paragraphs.map(p => p.text))).toEqual(passages.map(p => p.text))
  })

  it('accepts changed wording but propagates storage errors', async () => {
    const generate = vi.fn().mockResolvedValue(JSON.stringify({ p0: { text: 'Summary.' }, p1: { text: 'Balance 50.' } }))
    const bucket = store()
    const result = await renderSourcePassages(passages, 'en', 'en', 'chunk', bucket as any, 'run', generate, vi.fn())
    expect(result.flatMap(s => s.paragraphs.map(p => p.text))).toEqual(['Summary.', 'Balance 50.'])
    bucket.put.mockRejectedValueOnce(new Error('storage_unavailable'))
    await expect(renderSourcePassages(passages, 'en', 'en', 'chunk', bucket as any, 'run', generate, vi.fn())).rejects.toThrow('storage_unavailable')
  })
})

it('accepts changed numbers without generating the same passage again', async () => {
  const bucket = store()
  const report = vi.fn()
  const generate = vi.fn().mockResolvedValue(JSON.stringify({ p0: { text: '我们在 2010 年开始这个项目。', heading: '' } }))
  const result = await renderSourcePassages(
    [{ key: 'p0', text: 'We started in 2019 2010 and our goal was this project.', ids: ['c0105', 'c0106'] }],
    'en',
    'zh',
    'ambiguous',
    bucket as any,
    'run',
    generate,
    report
  )
  expect(generate).toHaveBeenCalledOnce()
  expect(result[0].paragraphs[0].source_cue_ids).toEqual(['c0105', 'c0106'])
  expect(report).toHaveBeenCalledWith('passage_accepted', 1)
  const stored = await bucket.get('ambiguous.passages')
  expect(JSON.parse(await stored!.text()).items[0].result.text).toContain('2010')
})

// Content quality belongs to prompts and offline evaluation, not online rejection.
it.each(['Wrong language.', '抱歉，无法翻译。', 'Short.', 'Changed 1000 to 50.'])('accepts nonempty output once: %s', async text => {
  const generate = vi.fn().mockResolvedValue(JSON.stringify({ p0: { text, heading: 'English heading' }, p1: { text, heading: '' } }))
  const result = await renderSourcePassages(passages, 'en', 'zh', 'chunk', store() as any, 'run', generate, vi.fn())
  expect(generate).toHaveBeenCalledOnce()
  expect(result.flatMap(s => s.paragraphs.map(p => p.text))).toEqual([text, text])
  expect(result[0].heading).toBe('English heading')
})
