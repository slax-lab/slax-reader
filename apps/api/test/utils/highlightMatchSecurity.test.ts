import { describe, expect, test } from 'vitest'
import { parseHTML } from 'linkedom'
import { mapHighlight } from '@/utils/hybridSearch/highlightMatch'
import { escapeHtml } from '@/utils/escape'

function renderHighlight(html: string) {
  const { document } = parseHTML('<html><body></body></html>')
  document.body.innerHTML = html
  for (const element of document.body.querySelectorAll('*')) {
    expect(element.tagName).toBe('MARK')
    expect(element.attributes.length).toBe(0)
  }
  return document.body
}

describe('mapHighlight HTML output', () => {
  test.each(['<img src=x onerror="void(0)">', '<svg onload="void(0)"></svg>', '<mark>saved</mark>', '<mark title="unsafe">saved</mark>', '&lt;img&gt; & "quoted"'])('escapes stored markup %s', text => {
    const html = mapHighlight(text, `[highlight]${text}[/highlight]`)
    expect(html).toBe(`<mark>${escapeHtml(text)}</mark>`)
    expect(renderHighlight(html).textContent).toBe(text)
  })

  test('preserves case-insensitive ordinary highlights and overlapping matches', () => {
    expect(mapHighlight('Hello world HELLO', '[highlight]hello[/highlight]')).toBe('<mark>Hello</mark> world <mark>HELLO</mark>')
    expect(mapHighlight('banana', '[highlight]ana[/highlight]')).toBe('b<mark>anana</mark>')
  })

  test('escapes each context and highlight fragment without changing source offsets', () => {
    const text = '<b>& "A&B"</b>'
    const html = mapHighlight(text, '[highlight]A&B[/highlight]')
    expect(html).toBe('&lt;b&gt;&amp; &quot;<mark>A&amp;B</mark>&quot;&lt;/b&gt;')
    expect(renderHighlight(html).textContent).toBe(text)
  })

  test.each(['', '[highlight]missing[/highlight]', '[highlight][/highlight]'])('escapes the original 60-character prefix when no token matches: %s', processed => {
    const text = '<mark>literal</mark><img src=x onerror="void(0)">' + '&'.repeat(80)
    const html = mapHighlight(text, processed)
    expect(html).toBe(escapeHtml(text.slice(0, 60)))
    expect(renderHighlight(html).textContent).toBe(text.slice(0, 60))
    expect(html).not.toContain('<mark>')
  })

  test('selects the same long-text window before escaping', () => {
    const text = 'x'.repeat(80) + '<img src=x> before & NEEDLE after <svg></svg>' + 'z'.repeat(80)
    const start = text.indexOf('NEEDLE') - 27
    const html = mapHighlight(text, '[highlight]needle[/highlight]')
    expect(html).toBe(escapeHtml(text.slice(start, start + 27)) + '<mark>NEEDLE</mark>' + escapeHtml(text.slice(start + 33, start + 60)))
    expect(renderHighlight(html).textContent).toBe(text.slice(start, start + 60))
  })

  test('escapes the fallback window when the final match falls between window steps', () => {
    const text = '<'.repeat(62) + 'X'
    const html = mapHighlight(text, '[highlight]X[/highlight]')
    expect(html).toBe('&lt;'.repeat(29) + '<mark>X</mark>')
    expect(renderHighlight(html).textContent).toBe('<'.repeat(29) + 'X')
  })

  test('keeps a match longer than the target window intact and escaped', () => {
    const token = '<b>' + '&'.repeat(64) + '</b>'
    const html = mapHighlight(`x${token}y`, `[highlight]${token}[/highlight]`)
    expect(html).toBe(`<mark>${escapeHtml(token)}</mark>`)
    expect(renderHighlight(html).textContent).toBe(token)
  })
})
