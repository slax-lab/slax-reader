import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { parseImport, readCSV } from '@/utils/importFormats'

// Optional local format checks. Source exports are never stored or uploaded.
const directory = process.env.IMPORT_SAMPLE_DIR
it.skipIf(!directory)('parses local exports', () => {
  for (const filename of readdirSync(directory!)) {
    if (filename.endsWith('.opml')) continue
    const text = readFileSync(join(directory!, filename), 'utf8')
    let result
    if (filename.endsWith('.json')) result = parseImport('pinboard', JSON.stringify(JSON.parse(text).slice(0, 12)))
    else if (filename.endsWith('.html')) {
      const links = text.match(/<DT><A[\s\S]*?<\/A>/g) || []
      result = parseImport('pinboard', '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL>' + links.slice(0, 12).join('\n'))
    } else if (filename.endsWith('.xml')) {
      const posts = text.match(/<post\s[^>]*\/>/g) || []
      result = parseImport('pinboard', '<posts>' + posts.slice(0, 12).join('\n') + '</posts>')
    } else if (filename.endsWith('.csv')) {
      const readwise = filename.toLowerCase().startsWith('readwise')
      if (readwise) {
        result = parseImport('readwise', text)
        expect(result.excluded_feed_count).toBeGreaterThan(0)
      } else {
        const rows = readCSV(text)
        const sample = rows.slice(0, 12)
        const headers = Object.keys(rows[0])
        const csv = [headers, ...sample.map(row => headers.map(key => row[key]))].map(row => row.map(v => `"${v.replaceAll('"', '""')}"`).join(',')).join('\n')
        result = parseImport('instapaper', csv)
      }
    } else continue
    expect(result.records.length).toBeGreaterThan(0)
    expect(result.records.length).toBeLessThanOrEqual(filename.toLowerCase().startsWith('readwise') ? 10_000 : 12)
    if (!filename.toLowerCase().startsWith('readwise')) expect(result.invalid_row_count).toBe(0)
    expect(result.invalid_date_count).toBe(0)
    console.log(`${filename}: ${result.records.length} records parsed locally`)
  }
})
