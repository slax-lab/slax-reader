import { describe, expect, it } from 'vitest'
import { ContentParser } from '../../src/utils/parser'
import { substackPublicationTime, youtubePublicationTime } from '../../src/utils/sourcePublicationTime'

const post = new URL('https://letters.example/p/one?utm_medium=email')
const date = '2025-06-01T15:30:00+08:00'
const node = { '@type': 'NewsArticle', url: 'https://letters.example/p/one', datePublished: date, dateModified: '2026-08-21T00:00:00Z' }
const article = (json: unknown) => `<html><head><title>Source title</title><link rel="preconnect" href="https://substackcdn.com"></head><body>
<script type="application/ld+json">${JSON.stringify(json)}</script><article><h1>Source title</h1><p>${'A full article paragraph with readable text. '.repeat(24)}</p></article></body></html>`

describe('source publication time', () => {
  it('uses the primary Substack post before either extraction engine strips JSON-LD', async () => {
    const content = article({ '@graph': [{ ...node, url: 'https://letters.example/p/related', datePublished: '2000-01-01' }, node] })
    const input = { url: post, content }
    expect((await ContentParser.parse(input)).publishedTime.toISOString()).toBe('2025-06-01T07:30:00.000Z')
    const candidates = await ContentParser.parseCandidates(input)
    for (const candidate of candidates) expect(candidate.parseRes?.publishedTime.toISOString()).toBe('2025-06-01T07:30:00.000Z')
  })

  it('ignores modification time, impossible dates and other publications', () => {
    expect(substackPublicationTime(post, article({ ...node, datePublished: undefined }))).toBeUndefined()
    expect(substackPublicationTime(post, article({ ...node, datePublished: '2025-02-31' }))).toBeUndefined()
    expect(substackPublicationTime(new URL('https://another.example/p/one'), article(node))).toBeUndefined()
  })

  it('reads the original watch page date and uses uploadDate when datePublished is missing', () => {
    const id = 'aircAruvnKk'
    const html = `<html><head><link rel="canonical" href="https://www.youtube.com/watch?v=${id}">
      <meta itemprop="uploadDate" content="2017-10-04"><meta itemprop="datePublished" content="2017-10-05T08:11:25-07:00"></head></html>`
    expect(youtubePublicationTime(html, id)).toBe('2017-10-05T15:11:25.000Z')
    expect(youtubePublicationTime(html.replace('datePublished', 'dateModified'), id)).toBe('2017-10-04T00:00:00.000Z')
    expect(youtubePublicationTime(html, 'hUhisi2FBuw')).toBeUndefined()
  })
})
