import { describe, expect, it } from 'vitest'
import { importPreview, parseImport, readCSV, readImportBody, readTagList, MAX_IMPORT_BYTES } from '@/utils/importFormats'

const csv = (rows: string[][]) => rows.map(row => row.map(v => `"${v.replaceAll('"', '""')}"`).join(',')).join('\r\n')
const readerHeader = ['Title', 'URL', 'ID', 'Document tags', 'Saved date', 'Reading progress', 'Location', 'Seen']
const readerRow = (url: string, location = 'later', tags = "['a, b', '中文']", date = '2023-09-18 03:15:32.264000+00:00') => ['Title', url, 'id', tags, date, '1', location, 'True']

describe('export parsing', () => {
  it('produces equivalent Pinboard metadata for JSON, HTML and XML', () => {
    const json = JSON.stringify([
      { href: 'https://example.com/a', description: 'A & B', tags: 'one two', time: '2024-09-25T23:05:21Z', toread: 'yes', extended: 'Do not import notes' }
    ])
    const html = '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><A HREF="https://example.com/a" ADD_DATE="1727305521" TOREAD="1" TAGS="one,two">A &amp; B</A>'
    const xml =
      '<?xml version="1.0"?><posts user="sample"><post href="https://example.com/a" description="A &amp; B" tag="one two" time="2024-09-25T23:05:21Z" toread="yes" /></posts>'
    const records = [json, html, xml].map(blob => parseImport('pinboard', blob).records)
    expect(records[0]).toEqual(records[1])
    expect(records[0]).toEqual(records[2])
    expect(records[0][0]).toMatchObject({ is_archive: false, saved_at: '2024-09-25T23:05:21.000Z', tags: ['one', 'two'] })
    expect(records[0][0]).not.toHaveProperty('description')
    expect(parseImport('pinboard', xml.replace(' toread="yes"', '')).records[0].is_archive).toBe(true)
    expect(parseImport('pinboard', html.replace('TOREAD="1"', 'TOREAD=""')).records[0].is_archive).toBe(true)
  })

  it('handles BOM, quoted commas, quotes and newlines by column name', () => {
    expect(readCSV('\uFEFFURL,Title\r\nhttps://example.com,"a, ""b""\n中文"\r\n')).toEqual([{ URL: 'https://example.com', Title: 'a, "b"\n中文' }])
    for (const text of ['URL,Title\na,"broken', 'URL,Title\na,"b"x', 'URL,Title\na', 'URL,URL\na,b']) expect(() => readCSV(text)).toThrow()
  })

  it('filters feeds, merges duplicate tags and preserves the newest saved state', () => {
    const blob = csv([
      readerHeader,
      readerRow('https://example.com/a', 'feed', "['feed']", '2026-01-01T00:00:00Z'),
      readerRow('https://example.com/a', 'later', "['old']"),
      readerRow('https://example.com/a', 'archive', "['new']", '2025-01-01T00:00:00Z'),
      readerRow('https://example.com/b', 'new')
    ])
    const result = parseImport('readwise', blob)
    expect(result).toMatchObject({ excluded_feed_count: 1, duplicate_count: 1, invalid_row_count: 0 })
    expect(result.records.find(r => r.target_url.endsWith('/a'))).toMatchObject({ is_archive: true, tags: ['old', 'new'] })
    const included = parseImport('readwise', blob, true)
    expect(included.duplicate_count).toBe(2)
    expect(included.records.find(r => r.target_url.endsWith('/a'))).toMatchObject({ is_archive: true, tags: ['feed', 'old', 'new'] })
    expect(result.records.find(r => r.target_url.endsWith('/b'))).toMatchObject({ saved_at: '2023-09-18T03:15:32.264Z', is_archive: false })
  })

  it('filters a large Readwise feed without retaining the full CSV table', () => {
    const header = csv([readerHeader])
    const feedRow = `${csv([readerRow('https://example.com/feed', 'feed', '[]')])}\n`
    const savedRow = csv([readerRow('https://example.com/saved', 'later', '[]')])
    const blob = `${header}\n${feedRow.repeat(60_000)}${savedRow}`
    const before = process.memoryUsage().heapUsed

    const result = parseImport('readwise', blob)
    const retainedHeap = process.memoryUsage().heapUsed - before

    expect(result.excluded_feed_count).toBe(60_000)
    expect(result.records).toHaveLength(1)
    expect(retainedHeap).toBeLessThan(64 * 1024 * 1024)
  })

  it('rejects new-source imports that exceed the bounded queue fan-out', () => {
    const rows = Array.from({ length: 10_001 }, (_, i) => readerRow(`https://example.com/feed/${i}`, 'feed', '[]'))
    expect(() => parseImport('readwise', csv([readerHeader, ...rows]), true)).toThrow('Export exceeds 10000 bookmarks')
  })

  it('parses string lists without evaluating code', () => {
    expect(readTagList(`["a, b", 'it\\'s', '中文', 'a, b', '\\u0041']`)).toEqual(['a, b', "it's", '中文', 'A'])
    for (const text of ['[process.exit()]', '[1]', "['a'", '["a"] trailing']) expect(() => readTagList(text)).toThrow()
  })

  it('maps Instapaper archive, starred, custom folders and Unix seconds', () => {
    const blob = csv([
      ['URL', 'Title', 'Selection', 'Folder', 'Timestamp', 'Tags'],
      ['https://example.com/a', 'A', 'Ignore selection', 'Archive', '1727304929', '[]'],
      ['https://example.com/b', 'B', '', 'Starred', '1390638524', '["tag"]'],
      ['https://example.com/c', 'C', '', 'Projects', '1390638524', "['a, b']"]
    ])
    const { records } = parseImport('instapaper', blob)
    expect(records.find(r => r.target_url.endsWith('/a'))).toMatchObject({ is_archive: true, saved_at: '2024-09-25T22:55:29.000Z' })
    expect(records.find(r => r.target_url.endsWith('/b'))).toMatchObject({ is_starred: true, tags: ['tag'] })
    expect(records.find(r => r.target_url.endsWith('/c'))?.tags).toEqual(['a, b', 'Projects'])
  })

  it('skips invalid URLs and warns about invalid optional dates', () => {
    const result = parseImport('readwise', csv([readerHeader, readerRow('javascript:alert(1)'), readerRow('https://example.com', 'later', '[]', 'bad')]))
    expect(result).toMatchObject({ invalid_row_count: 1, invalid_date_count: 1 })
    expect(result.records[0].saved_at).toBeUndefined()
  })

  it('rejects wrong schemas, OPML, malformed XML and external entities', () => {
    for (const blob of ['<opml/>', '<posts><post href="a"></posts>', '<!DOCTYPE posts SYSTEM "file:///etc/passwd"><posts/>', '[{"title":"wrong"}]'])
      expect(() => parseImport('pinboard', blob)).toThrow()
    expect(() => parseImport('readwise', 'URL,Title\n')).toThrow()
    expect(parseImport('readwise', csv([readerHeader])).records).toEqual([])
  })

  it('bounds preview output and rejects oversized request bodies', async () => {
    const result = parseImport('readwise', csv([readerHeader, ...Array.from({ length: 15 }, (_, i) => readerRow(`https://example.com/${i}`))]))
    expect(importPreview(result)).toMatchObject({ eligible_count: 15 })
    expect(importPreview(result).preview).toHaveLength(10)
    await expect(
      readImportBody(new Request('https://example.com', { method: 'POST', headers: { 'content-length': String(MAX_IMPORT_BYTES + 1) }, body: 'small' }))
    ).rejects.toThrow()
    await expect(readImportBody(new Request('https://example.com', { method: 'POST', body: '中文' }))).resolves.toBe('中文')
  })
})
