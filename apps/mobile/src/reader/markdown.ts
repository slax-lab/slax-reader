const escape = (text: string) => text.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]!))

/** Outline markdown is data: never interpolate its raw HTML or execute its scripts. */
export function markdownInline(text: string): string {
  const tokens: string[] = []
  const token = (html: string) => `\u0000${tokens.push(html) - 1}\u0000`
  let safe = text.replace(/`([^`]+)`/g, (_match, code: string) => token(`<code>${escape(code)}</code>`))
  safe = safe.replace(/\[([^\]]+)\]\(([^\s)]*(?:\([^)]*\)[^\s)]*)*)\)/g, (_match, label: string, href: string) => {
    if (!href.startsWith('#') && !/^https?:\/\//i.test(href)) return token(escape(label))
    return token(`<a href="${escape(href)}">${markdownInline(label)}</a>`)
  })
  safe = escape(safe)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
    .replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
  return safe.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => tokens[Number(index)] ?? '')
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n')
  const blocks: string[] = []
  const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())
  for (let index = 0; index < lines.length;) {
    const line = lines[index]
    if (!line.trim()) { index++; continue }
    const fence = /^\s*(```+|~~~+)\s*([^\s]*)/.exec(line)
    if (fence) {
      const body: string[] = []; index++
      while (index < lines.length && !lines[index].trim().startsWith(fence[1])) body.push(lines[index++])
      index++; blocks.push(`<pre><code>${escape(body.join('\n'))}</code></pre>`); continue
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.*)/.exec(line)
    if (heading) { blocks.push(`<h${heading[1].length}>${markdownInline(heading[2].replace(/\s+#+\s*$/, ''))}</h${heading[1].length}>`); index++; continue }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { blocks.push('<hr>'); index++; continue }
    if (line.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] ?? '')) {
      const header = cells(line); index += 2
      const rows: string[] = []
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) rows.push(`<tr>${cells(lines[index++]).map(cell => `<td>${markdownInline(cell)}</td>`).join('')}</tr>`)
      blocks.push(`<table><thead><tr>${header.map(cell => `<th>${markdownInline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`); continue
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^\s*>/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ''))
      blocks.push(`<blockquote>${markdownToHtml(quote.join('\n'))}</blockquote>`); continue
    }
    const list = /^(\s*)([-+*]|\d+[.)])\s+(.*)/.exec(line)
    if (list) {
      const ordered = /^\d/.test(list[2]); const tag = ordered ? 'ol' : 'ul'; const items: string[] = []
      while (index < lines.length) {
        const item = /^(\s*)([-+*]|\d+[.)])\s+(.*)/.exec(lines[index])
        if (!item || item[1].length !== list[1].length || /^\d/.test(item[2]) !== ordered) break
        const body = [item[3]]; index++
        while (index < lines.length && lines[index].trim() && /^\s+/.test(lines[index]) && (lines[index].match(/^\s*/)![0].length > list[1].length)) body.push(lines[index++].slice(list[1].length + 2))
        items.push(`<li>${body.length > 1 ? markdownToHtml(body.join('\n')) : markdownInline(body[0])}</li>`)
      }
      blocks.push(`<${tag}>${items.join('')}</${tag}>`); continue
    }
    const paragraph = [line]; index++
    while (index < lines.length && lines[index].trim() && !/^(\s{0,3}#{1,6}\s|\s*>|\s*[-+*]\s|\s*\d+[.)]\s|\s*```|\s*~~~)/.test(lines[index])) paragraph.push(lines[index++])
    blocks.push(`<p>${markdownInline(paragraph.join('\n')).replace(/ {2}\n/g, '<br>').replaceAll('\n', ' ')}</p>`)
  }
  return blocks.join('\n')
}
