import { describe, expect, it, vi } from 'vitest'
import {
  ArticleModelError,
  ChunkTruncated,
  passageIssues,
  pendingPassageText,
  readPassageProgress,
  renderSourcePassages,
  sourcePassages,
  type SourcePassage
} from '@/utils/youtubeEditing'

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

  it.each([
    ['en', 'en', 'We dont need 1000 votes.', "We don't need 1,000 votes."],
    ['zh', 'zh', '大家好欢迎回来今天我们继续讨论昨天的问题', '大家好，欢迎回来今天我们继续讨论昨天的问题！'],
    ['en', 'zh', 'We earned 50000 and 1.5 million at 50%.', '我们赚了 5 万和 150 万，比例为百分之50。'],
    ['de', 'en', 'Der Wert ist 1.234,5.', 'The value is 1,234.5.'],
    ['en', 'zh', 'OpenAI', 'OpenAI'],
    ['en', 'zh', 'Sam Altman', 'Sam Altman'],
    ['en', 'zh', 'Yes.', '是的。'],
    ['en', 'zh', 'Here is a check for 70 grand.', '这里有一张 70,000 美元的支票。'],
    ['en', 'zh', 'We reached 15 mil ARR in 4 months.', '我们在4个月内做到了1500万ARR。'],
    ['en', 'zh', 'We pay 50 or 100,000 dollars a year.', '我们每年支付5万或10万美元。'],
    ['en', 'zh', 'The Mag 7 are large companies.', '七巨头都是大公司。'],
    ['en', 'zh', 'We are 10 20% of the city.', '我们占全市的10%到20%。'],
    ['en', 'zh', 'The balance is -50 and 1.5.', '余额是负五十和一点五。'],
    ['en', 'zh', 'Revenue reached 120 million.', '收入达到一亿两千万。']
  ] as const)('accepts supported punctuation, numbers and short text (%s to %s)', (sourceLang, target, source, translated) => {
    expect(passageIssues(source, translated, sourceLang, target)).toEqual([])
  })

  it.each([
    ['My balance is -50.', '我的余额是 50。', 'numbers:-50'],
    ['We bought 1000 shares.', '我们买了 100 股。', 'numbers:1000'],
    ['That works.', 'That works.', 'wrong_language'],
    ['A substantive explanation of the project and its constraints. '.repeat(12), '很好。', 'length_ratio'],
    ['Translate this explanation.', '抱歉，无法翻译。', 'model_error']
  ])('rejects a damaged translation (%s)', (source, translated, reason) => {
    expect(passageIssues(source, translated, 'en', 'zh')).toContain(reason)
  })

  it('repairs missing or invalid passages using feedback without regenerating accepted passages', async () => {
    const bucket = store()
    const generate = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ p0: { text: translations[0] }, p1: { text: 'This is not translated.' } }))
      .mockResolvedValueOnce(JSON.stringify({ p1: { text: translations[1] } }))
    const result = await renderSourcePassages(passages, 'en', 'zh', 'chunk', bucket as any, 'run', generate, vi.fn())
    expect(generate.mock.calls.map(c => c[2])).toEqual([['p0', 'p1'], ['p1']])
    expect(JSON.parse(generate.mock.calls[1][1]).p1).toMatchObject({ repair: 'wrong_language', previous: 'This is not translated.' })
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
    const progress = await readPassageProgress(passages, 'en', 'zh', 'chunk', bucket as any, 'run')
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

  it('resumes an interrupted assembly repair without invalidating its newly accepted passages again', async () => {
    const bucket = store()
    const good = JSON.stringify({ p0: { text: translations[0] }, p1: { text: translations[1] } })
    const generate = vi.fn().mockResolvedValueOnce(good)
    await renderSourcePassages(passages, 'en', 'zh', 'chunk', bucket as any, 'run', generate, vi.fn())
    generate
      .mockResolvedValueOnce(JSON.stringify({ p0: { text: translations[0] } }))
      .mockRejectedValueOnce(new ArticleModelError())
      .mockResolvedValueOnce(JSON.stringify({ p1: { text: translations[1] } }))
    const repair = () => renderSourcePassages(passages, 'en', 'zh', 'chunk', bucket as any, 'run', generate, vi.fn(), { p0: 'wrong_language', p1: 'wrong_language' })
    await expect(repair()).rejects.toThrow('model_request_failed')
    await repair()
    expect(generate.mock.calls.map(c => c[2])).toEqual([['p0', 'p1'], ['p0'], ['p1'], ['p1']])
  })

  it('isolates repeated long output while accepting real short repeated replies', async () => {
    const source = [
      {
        key: 'p0',
        text: 'The discussion describes how companies recruit engineers and how they evaluate their skills before making an offer. Each candidate has an opportunity to ask questions about the role and responsibilities.',
        ids: ['c0']
      },
      {
        key: 'p1',
        text: 'The second topic concerns the office location, facilities available to the team and public transportation. The speaker explains the advantages of working together while also allowing some flexibility in schedules.',
        ids: ['c1']
      }
    ]
    const first = '这段讨论介绍了公司如何招聘工程师，以及如何在发出录用通知之前评估他们的技能。每位候选人都有机会就职位和职责提出自己的问题。'
    const second = '第二个话题涉及办公地点、团队可用设施及公共交通。讲话者解释了大家一起办公的优势，同时也允许在工作安排方面保留一定灵活性。'
    const generate = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ p0: { text: first }, p1: { text: first } }))
      .mockResolvedValueOnce(JSON.stringify({ p1: { text: second } }))
    await renderSourcePassages(source, 'en', 'zh', 'chunk', store() as any, 'run', generate, vi.fn())
    expect(Object.keys(JSON.parse(generate.mock.calls[1][1]))).toEqual(['p1'])
    expect(JSON.parse(generate.mock.calls[1][1]).p1.repair).toContain('duplicate_paragraph')
    const short = source.map(p => ({ ...p, text: 'Yes.' }))
    const repeated = await renderSourcePassages(
      short,
      'en',
      'zh',
      'chunk',
      store() as any,
      'run',
      async () => JSON.stringify({ p0: { text: '是的。' }, p1: { text: '是的。' } }),
      vi.fn()
    )
    expect(repeated[0].paragraphs).toHaveLength(2)
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

  it('preserves source on destructive edits but propagates storage errors', async () => {
    const generate = vi.fn().mockResolvedValue(JSON.stringify({ p0: { text: 'Summary.' }, p1: { text: 'Balance 50.' } }))
    const bucket = store()
    const result = await renderSourcePassages(passages, 'en', 'en', 'chunk', bucket as any, 'run', generate, vi.fn())
    expect(result.flatMap(s => s.paragraphs.map(p => p.text))).toEqual(passages.map(p => p.text))
    bucket.put.mockRejectedValueOnce(new Error('storage_unavailable'))
    await expect(renderSourcePassages(passages, 'en', 'en', 'chunk', bucket as any, 'run', generate, vi.fn())).rejects.toThrow('storage_unavailable')
  })
})

it('retains an ambiguous year as a diagnostic without generating the same passage again', async () => {
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
  expect(report).toHaveBeenCalledWith('passage_diagnostic', expect.any(Number))
  const stored = await bucket.get('ambiguous.passages')
  expect(JSON.parse(await stored!.text()).items[0].diagnostics).toContain('numbers:2019')
})
