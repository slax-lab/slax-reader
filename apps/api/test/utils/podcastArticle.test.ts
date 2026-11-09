/**
 * Podcast article pure functions: polish prompt, translation units and parsing, quality options,
 * costs, keys and the body renderer (including injection of model and feed text).
 * 来源: src/utils/podcastArticle.ts, docs/podcast-article/spec.md 第 3.2、4.4、4.5、6、7 节
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { checkArticleQuality, mergeChunkResults, parseChunkOutput, type YoutubeArticleDocument } from '@/utils/youtubeArticle'
import { buildTranscriptDocument, parseVtt, transcriptPlainText } from '@/utils/podcastTranscript'
import { HtmlBuilder } from '@/utils/htmlBuilder'
import {
  applyTranslation,
  articleParagraphText,
  buildPolishInstruction,
  buildPolishUserMessage,
  buildTranslationInstruction,
  buildTranslationUserMessage,
  chunkTail,
  chunkTranslationUnits,
  expectedEpisodeCostUsd,
  mergeGlossary,
  parseTranslationOutput,
  planPodcastChunks,
  podcastArticleKeys,
  podcastArticleVersion,
  podcastChunkKey,
  podcastTranscriptKey,
  podcastWorkflowId,
  renderMediaArticle,
  renderPodcastBody,
  renderPodcastText,
  speakerDisplay,
  translateSpeaker,
  translationUnits
} from '@/utils/podcastArticle'

const transcript = buildTranscriptDocument('publisher', 'en', parseVtt(readFileSync(join(__dirname, '../fixtures/podcast/buzzsprout.vtt'), 'utf8')))
const ctx = { title: 'Brazil data centers', showName: 'Tech Won’t Save Us', shownotes: 'Paris Marx is joined by Ana.' }

/** A faithful cleanup of the fixture: every cue, in order, lightly edited. */
function cleanedDoc(): YoutubeArticleDocument {
  const half = Math.ceil(transcript.cues.length / 2)
  const para = (cues: typeof transcript.cues) => ({ speaker: cues[0].speaker ?? null, text: cues.map(c => c.text).join(' '), source_cue_ids: cues.map(c => c.id) })
  const first = transcript.cues.slice(0, half)
  const second = transcript.cues.slice(half)
  const raw = JSON.stringify({
    lede: 'Data centers in Brazil and a new book.',
    sections: [
      { heading: 'Renewables become tech companies', paragraphs: [para(first)] },
      { heading: 'The book Hyperscale', paragraphs: [para(second)] }
    ]
  })
  const parsed = parseChunkOutput(raw)
  if (!parsed.ok) throw new Error(parsed.error)
  return mergeChunkResults([parsed.value], transcript.cues, 'en', 'dialogue')
}

describe('keys and ids', () => {
  test('canonical keys follow the spec layout', () => {
    expect(podcastTranscriptKey('s1', 'h1')).toBe('podcast/canonical/transcripts/s1/h1.json')
    expect(podcastArticleKeys('s1', 'abc', 'zh')).toEqual({
      jsonKey: 'podcast/canonical/articles/s1/abc-zh-1-v1.json',
      htmlKey: 'podcast/canonical/articles/s1/abc-zh-1-v1.html',
      textKey: 'podcast/canonical/articles/s1/abc-zh-1-v1.txt'
    })
    expect(podcastChunkKey('s1', 'abc', 'en', 3)).toBe('podcast/canonical/chunks/s1/abc-en-1-v1/3.json')
    expect(podcastArticleVersion('0123456789abcdef', 'en')).toBe('0123456789ab-en-1-v1')
    expect(podcastWorkflowId('s1', 36)).toBe('pod-s1-10')
  })
})

describe('podcast request sizing', () => {
  test('budgets serialized cue metadata, system prompt, schema and output headroom', async () => {
    const { podcastRequestSize, PODCAST_LIMITS } = await import('@/utils/podcastArticle')
    const { estimateTokens } = await import('@/utils/youtubeArticle')
    const cues = Array.from({ length: 280 }, (_, i) => ({
      id: `c${String(i + 1).padStart(4, '0')}`,
      start_ms: i * 10_000,
      duration_ms: 10_000,
      speaker: 'Speaker label',
      text: 'Short sentence.'
    }))
    expect(estimateTokens(cues.map(c => c.text).join(' '))).toBeLessThan(PODCAST_LIMITS.chunkTargetTokens)
    const system = buildPolishInstruction('en', ctx, { index: 0, start: 0, end: cues.length, overlap: 0 }, 1, null)
    const size = podcastRequestSize(system, buildPolishUserMessage(cues), {})
    expect(size.userTokens).toBeGreaterThan(PODCAST_LIMITS.chunkTargetTokens)
    expect(size.inputTokens).toBeGreaterThan(size.userTokens + size.systemTokens)
    expect(size.oversized).toBe(true)
    expect(podcastRequestSize('system '.repeat(4000), 'short', {}).oversized).toBe(true)
    expect(podcastRequestSize('system', 'short', { description: 'schema '.repeat(4000) }).oversized).toBe(true)
    expect(size.outputTokens + PODCAST_LIMITS.outputHeadroomTokens).toBeLessThan(PODCAST_LIMITS.maxOutputTokens)
    expect(PODCAST_LIMITS.maxOutputTokens).toBe(65_536)
  })

  test('scales the requested output ceiling with serialized input up to 65536', async () => {
    const { podcastRequestSize, PODCAST_LIMITS, PODCAST_POLISH_RESPONSE_SCHEMA } = await import('@/utils/podcastArticle')
    const sizes = [100, 1000, 3000, 14_336, 20_000].map(tokens => podcastRequestSize('system', 'word'.repeat(tokens), PODCAST_POLISH_RESPONSE_SCHEMA))
    for (const size of sizes) {
      expect(size.outputLimit).toBe(Math.min(65_536, size.userTokens * PODCAST_LIMITS.outputExpansion + PODCAST_LIMITS.outputHeadroomTokens))
      expect(size.outputLimit).toBeLessThanOrEqual(PODCAST_LIMITS.maxOutputTokens)
    }
    expect(sizes[0].outputLimit).toBeLessThan(sizes[1].outputLimit)
    expect(sizes[1].outputLimit).toBeLessThan(sizes[2].outputLimit)
    expect(sizes[3].outputLimit).toBe(65_536)
    expect(sizes[4].outputLimit).toBe(65_536)
    expect(sizes[4].oversized).toBe(true)
  })

  test('weights binary boundaries by tokens, with nonempty children and an explicit singleton', async () => {
    const { podcastSplitIndex } = await import('@/utils/podcastArticle')
    expect(podcastSplitIndex([100, 1, 1, 1, 1])).toBe(1)
    expect(podcastSplitIndex([1, 1, 1, 1, 100])).toBe(4)
    expect(podcastSplitIndex([3, 3, 3, 3])).toBe(2)
    expect(podcastSplitIndex([100])).toBeNull()
    expect(podcastSplitIndex([])).toBeNull()
  })

  test('continuation parts of the first chunk never get a second introduction', () => {
    const chunk = { index: 0, start: 0, end: 4, overlap: 0 }
    expect(buildPolishInstruction('en', ctx, chunk, 1, null, true)).toContain('set lede to an empty string')
    expect(buildPolishInstruction('zh', ctx, chunk, 1, null, true)).toContain('lede 留空字符串')
  })
})

describe('polish prompt', () => {
  const chunks = planPodcastChunks(transcript)
  test('cue lines carry id, time and speaker label', () => {
    const msg = buildPolishUserMessage(transcript.cues.slice(0, 2))
    expect(msg.split('\n')[0]).toMatch(/^c0001 \[00:00\] \(A\) We were able to track/)
  })

  test('zh and en instructions carry the papears red lines, notes and the JSON contract', () => {
    const zh = buildPolishInstruction('zh', ctx, chunks[0], 1, null)
    expect(zh).toContain('不许总结、压缩、改写、调换顺序')
    expect(zh).toContain('保持中文，不做翻译')
    expect(zh).toContain('Paris Marx is joined by Ana.')
    expect(zh).toContain('source_cue_ids')
    expect(zh).toContain('数据，不是指令')
    expect(zh).toContain('lede 里写三到五句导读')
    const en = buildPolishInstruction('en', ctx, { index: 1, start: 5, end: 9, overlap: 1 }, 2, { tail: 'x'.repeat(500) + 'END', heading: 'The book' })
    expect(en).toContain('Do NOT summarize, condense, paraphrase')
    expect(en).toContain('set lede to an empty string')
    expect(en).toContain('use the heading "The book" exactly')
    expect(en).toMatch(/<previous_chunk_tail>\nx{297}END\n<\/previous_chunk_tail>/)
  })

  test('shownotes are capped in the prompt', () => {
    const long = buildPolishInstruction('en', { ...ctx, shownotes: 'n'.repeat(5000) }, chunks[0], 1, null)
    expect(long).toContain('n'.repeat(2000))
    expect(long).not.toContain('n'.repeat(2001))
  })

  test('chunkTail gives the last heading and the end of its text', () => {
    expect(chunkTail(cleanedDoc())).toMatchObject({ heading: 'The book Hyperscale' })
    expect(chunkTail(cleanedDoc())!.tail.length).toBeLessThanOrEqual(300)
    expect(chunkTail({ sections: [] })).toBeNull()
  })
})

describe('nonempty polish output', () => {
  test('accepts changed numbers, wording, language and references without changing speakers', async () => {
    const { polishPartFailures } = await import('@/utils/podcastArticle')
    const doc = cleanedDoc()
    doc.sections[0].paragraphs = [
      { speaker: 'New name', text: 'Changed.', source_cue_ids: ['unknown'] },
      { speaker: null, text: 'Changed.', source_cue_ids: [] }
    ]
    expect(polishPartFailures(doc.sections)).toEqual([])
    expect(checkArticleQuality(doc, transcriptPlainText(transcript)).passed).toBe(true)
    expect(doc.sections[0].paragraphs[0].speaker).toBe('New name')
    doc.sections[0].paragraphs[0].text = ' '
    expect(polishPartFailures(doc.sections)).toEqual(['empty_block'])
  })
})

describe('translation', () => {
  const doc = cleanedDoc()
  const units = translationUnits(doc)

  test('units number the lede, headings and paragraphs', () => {
    expect(units.map(u => u.id)).toEqual(['lede', 'h001', 'p0001', 'h002', 'p0002'])
    expect(buildTranslationUserMessage({ index: 0, units: units.slice(0, 2) })).toBe(`lede: ${doc.lede}\n\nh001: Renewables become tech companies`)
  })

  test('chunks never split a heading from its first paragraph', () => {
    const chunks = chunkTranslationUnits(units, 10)
    expect(chunks.map(c => c.units.map(u => u.id))).toEqual([['lede'], ['h001', 'p0001'], ['h002', 'p0002']])
    expect(chunkTranslationUnits(units).length).toBe(1)
  })

  test('instructions: zh carries the papears rules; en mirrors them; both carry the glossary', () => {
    const zh = buildTranslationInstruction('en', 'zh', ctx, 'prev', [{ term: 'hyperscaler', translation: '超大规模云厂商' }])
    expect(zh).toContain('说中国话')
    expect(zh).toContain('hyperscaler = 超大规模云厂商')
    expect(zh).toContain('每个输入编号恰好出现一次')
    const en = buildTranslationInstruction('zh', 'en', ctx, '', [])
    expect(en).toContain('Translate every item into English')
    expect(en).toContain('exactly once')
  })

  test('parse: all ids once, nothing extra, no empty text', () => {
    const ids = ['lede', 'h001', 'p0001']
    const ok = parseTranslationOutput(
      JSON.stringify({
        items: ids.map(id => ({ id, text: `T ${id}` })),
        glossary: [
          { term: 'A', translation: '甲' },
          { term: '', translation: 'x' }
        ]
      }),
      ids
    )
    expect(ok).toMatchObject({ ok: true, glossary: [{ term: 'A', translation: '甲' }] })
    expect(ok.ok && ok.texts.get('p0001')).toBe('T p0001')
    expect(parseTranslationOutput('```json\n{"items":[{"id":"lede","text":"x"}]}\n```', ['lede'])).toMatchObject({ ok: true })
    expect(parseTranslationOutput('nope', ids)).toEqual({ ok: false, error: 'not_json' })
    expect(parseTranslationOutput('{"x":1}', ids)).toEqual({ ok: false, error: 'bad_shape' })
    expect(parseTranslationOutput(JSON.stringify({ items: [{ id: 'lede', text: 'x' }] }), ids)).toEqual({ ok: false, error: 'missing_id' })
    expect(parseTranslationOutput(JSON.stringify({ items: [{ id: 'p9999', text: 'x' }] }), ids)).toEqual({ ok: false, error: 'extra_id' })
    expect(
      parseTranslationOutput(
        JSON.stringify({
          items: [
            { id: 'lede', text: 'x' },
            { id: 'lede', text: 'y' }
          ]
        }),
        ids
      )
    ).toEqual({ ok: false, error: 'extra_id' })
    expect(parseTranslationOutput(JSON.stringify({ items: [{ id: 'lede', text: ' ' }] }), ['lede'])).toEqual({ ok: false, error: 'empty_text' })
  })

  test('glossary: first translation wins, capped', () => {
    const g = mergeGlossary(
      [{ term: 'AI', translation: '人工智能' }],
      [
        { term: 'ai', translation: 'AI' },
        { term: 'GPU', translation: '显卡' },
        { term: 'TPU', translation: '张量处理器' }
      ],
      2
    )
    expect(g).toEqual([
      { term: 'AI', translation: '人工智能' },
      { term: 'GPU', translation: '显卡' }
    ])
  })

  test('applyTranslation keeps structure and cue ids, maps roles, keeps names and labels', () => {
    const src = cleanedDoc()
    src.sections[0].paragraphs[0].speaker = 'Host'
    src.sections[1].paragraphs[0].speaker = 'Paris Marx'
    const texts = new Map(units.map(u => [u.id, u.kind === 'heading' ? '标题' : '这是译文，巴西 60% 的数据中心申请来自可再生能源公司。'.repeat(u.kind === 'lede' ? 1 : 12)]))
    const out = applyTranslation(src, units, texts, 'zh')
    expect(out.language).toBe('zh')
    expect(out.sections.map(s => s.paragraphs.map(p => p.source_cue_ids))).toEqual(src.sections.map(s => s.paragraphs.map(p => p.source_cue_ids)))
    expect(out.sections.map(s => s.paragraphs[0].speaker)).toEqual(['主持人', 'Paris Marx'])
    expect(src.language).toBe('en')
    expect(() => applyTranslation(src, units, new Map(), 'zh')).toThrow('translation missing for lede')
    expect(translateSpeaker('嘉宾', 'en')).toBe('Guest')
    expect(translateSpeaker('B', 'zh')).toBe('B')
  })
})

describe('costs', () => {
  test('a 1-hour English episode with AssemblyAI and one translation stays under the 1 USD cap', () => {
    const cost = expectedEpisodeCostUsd({ durationSec: 3600, language: 'en', needsTranscription: true, translations: 1 })
    expect(cost).toBeGreaterThan(0.17)
    expect(cost).toBeLessThan(1)
  })

  test('a publisher transcript costs no transcription; a real transcript replaces the estimate', () => {
    const withAsr = expectedEpisodeCostUsd({ durationSec: 3600, language: 'zh', needsTranscription: true, translations: 0 })
    const publisher = expectedEpisodeCostUsd({ durationSec: 3600, language: 'zh', needsTranscription: false, translations: 0 })
    expect(withAsr - publisher).toBeCloseTo(0.17, 2)
    expect(expectedEpisodeCostUsd({ durationSec: 3600, language: 'en', needsTranscription: false, transcriptText: 'short', translations: 0 })).toBeLessThan(publisher)
  })
})

describe('rendering', () => {
  const info = {
    audioUrl: 'https://cdn.example.com/ep.mp3',
    title: 'Ep "1" <b>',
    showName: 'Show',
    coverUrl: 'javascript:alert(1)',
    durationSec: 180,
    shownotes: 'Line one\n\nLine <two>',
    language: 'en' as const
  }

  test('before the article: player with fallback audio and show notes, no cues', () => {
    const html = renderPodcastBody({ info })
    expect(html).toContain('<slax-media data-kind="audio" data-src="https://cdn.example.com/ep.mp3" data-title="Ep &quot;1&quot; &lt;b&gt;"')
    expect(html).toContain('data-cover=""')
    expect(html).toContain('data-duration-ms="180000"')
    expect(html).toContain('<audio controls preload="none" src="https://cdn.example.com/ep.mp3"></audio>')
    expect(html).not.toContain('data-cues')
    expect(html).toContain('<h2>Show notes</h2>\n<p>Line one</p>\n<p>Line &lt;two&gt;</p>')
  })

  test('after: paragraphs carry their first cue start, a seek span and the speaker', () => {
    const doc = cleanedDoc()
    doc.sections[1].paragraphs[0].speaker = 'B'
    doc.sections[0].paragraphs[0].text = '<img src=x onerror=alert(1)> text'
    const html = renderPodcastBody({ info, article: { doc, version: 'v"1', cues: transcript.cues } })
    const second = transcript.cues[Math.ceil(transcript.cues.length / 2)]
    expect(html).toContain(`<p class="slax-pod-p" data-start-ms="160" data-cue-ids="`)
    expect(html).toContain(`<span class="slax-pod-time" data-media-seek="160" role="button" tabindex="0">00:00</span>`)
    expect(html).toContain(`data-start-ms="${second.start_ms}"`)
    expect(html).toContain('<span class="slax-pod-speaker">Speaker B</span>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; text')
    expect(html).not.toContain('<img')
    expect(html).toContain('data-article-version="v&quot;1"')
    expect(html).toMatch(/data-cues="\[\{&quot;t&quot;:0\.16,&quot;text&quot;:&quot;We were able/)
    expect(html.indexOf('slax-pod-article')).toBeLessThan(html.indexOf('slax-pod-notes'))
  })

  test('podcast uses the full YouTube reading hierarchy with podcast labels', () => {
    const doc = { ...cleanedDoc(), language: 'zh' as const, lede: '完整导读' }
    const html = renderMediaArticle(doc, 'v1', transcript.cues, 'podcast')
    expect(html).toContain('播客整理稿')
    expect(html).toContain('class="slax-yt-introduction"')
    expect(html).toContain('完整导读')
    expect(html).toContain('class="slax-yt-contents"')
    expect(html).toContain('href="#pod-topic-0"')
    expect(html).toContain('id="pod-topic-0"')
    expect(html).toContain('方法与来源')
    expect(html).not.toContain('原视频')
    expect(html).toContain('data-cue-ids=')
  })

  test('YouTube body: the same article markup, named youtube, after the player; a bad video id is dropped', () => {
    const article = renderMediaArticle(cleanedDoc(), 'v1', transcript.cues, 'youtube')
    expect(article).toContain('class="slax-yt-contents"')
    expect(article).toContain('href="#yt-topic-0"')
    expect(article).toContain('id="yt-topic-0"')
    expect(article).toContain('Method and source')
    expect(article).toContain('<article class="slax-pod-article" data-slax-derived="youtube-article" data-article-version="v1"')
    expect(article).toContain('<span class="slax-pod-time" data-media-seek="160" role="button" tabindex="0">00:00</span>')
    const body = HtmlBuilder.buildYoutubeArticleBody('abc_DEF-123', [{ t: 1, text: 'a "b"' }], article)
    expect(body).toContain('<youtube-player data-video-id="abc_DEF-123" data-cues="[{&quot;t&quot;:1,&quot;text&quot;:&quot;a \\&quot;b\\&quot;&quot;}]">')
    expect(body.indexOf('<youtube-player')).toBeLessThan(body.indexOf('slax-pod-article'))
    expect(HtmlBuilder.buildYoutubeArticleBody('"><script>', [], article)).not.toContain('<script>')
  })

  test('YouTube labels match the Web locale strings of the separate article view', () => {
    const doc = cleanedDoc()
    for (const [lang, file] of [
      ['en', 'en.json'],
      ['zh', 'zh.json']
    ] as const) {
      const locale = JSON.parse(readFileSync(join(__dirname, '../../../web/i18n/locales', file), 'utf8')).component.youtube_article
      const article = renderMediaArticle({ ...doc, language: lang, lede: 'Lede' }, 'v2', transcript.cues, 'youtube')
      expect(article).toContain(`<p class="slax-yt-edition">${locale.edited_transcript}</p>`)
      expect(article).toContain(`<span class="slax-yt-label">${locale.introduction}</span>`)
      expect(article).toContain(`<summary>${locale.contents} <span>`)
      expect(article).toContain(`<nav aria-label="${locale.contents}">`)
      expect(article).toContain(`<strong>${locale.method}</strong><p>${locale.method_note}</p>`)
    }
  })

  test('Spotify: embed only', () => {
    const html = renderPodcastBody({ info: { ...info, audioUrl: '', embedUrl: 'https://open.spotify.com/embed/episode/x' } })
    expect(html).toContain('<iframe class="slax-pod-embed" src="https://open.spotify.com/embed/episode/x"')
    expect(html).not.toContain('<slax-media')
  })

  test('zh labels and plain text without timestamps', () => {
    expect(speakerDisplay('A', 'zh')).toBe('说话人 A')
    expect(speakerDisplay('主持人', 'zh')).toBe('主持人')
    const doc = cleanedDoc()
    doc.sections[0].paragraphs[0].speaker = 'A'
    const text = renderPodcastText({ info, doc })
    expect(text).toMatch(/^Ep "1" <b>\n\nData centers in Brazil/)
    expect(text).toContain('Speaker A: We were able to track')
    expect(text).not.toMatch(/\d\d:\d\d/)
    expect(text.trim().endsWith('Line <two>')).toBe(true)
  })
})
