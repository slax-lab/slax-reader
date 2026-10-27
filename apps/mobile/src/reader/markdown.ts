import MarkdownIt, {type Token} from 'markdown-it'
import markdownItCjkFriendly from 'markdown-it-cjk-friendly'

/** Outline links stay inert data: only in-document anchors and http(s) targets survive as links. */
export const outlineLinkAllowed = (href: string) => href.startsWith('#') || /^https?:\/\//i.test(href)

/**
 * Outline markdown is data: raw HTML is escaped, images render as their alt text without loading, bare URLs
 * are not linkified, and links with any other destination keep only their label.
 */
function createOutlineMarkdown() {
  const md = new MarkdownIt('default', {html: false, linkify: false, typographer: false, breaks: false})
  md.use(markdownItCjkFriendly)
  // Every destination parses as a link so its label is kept; the core rule below removes the disallowed ones.
  md.validateLink = () => true
  md.renderer.rules.image = (tokens, index, options, env, self) => md.utils.escapeHtml(self.renderInlineAsText(tokens[index].children ?? [], options, env))
  md.core.ruler.push('outline_unsafe_links', state => {
    for (const block of state.tokens) {
      if (block.type !== 'inline' || !block.children) continue
      let dropping = false
      block.children = block.children.filter(token => {
        if (token.type === 'link_open') {dropping = !outlineLinkAllowed(String(token.attrGet('href') ?? '')); return !dropping}
        if (token.type === 'link_close') {const drop = dropping; dropping = false; return !drop}
        return true
      })
    }
  })
  return md
}
const outline = createOutlineMarkdown()

interface MarkdownBlock {start: number; end: number; html: string}
const normalize = (markdown: string) => markdown.replace(/\r\n?/g, '\n').replace(/\0/g, '\uFFFD')
/** Reference definitions bind links anywhere in the document, so such documents always render as a whole. */
const referenceDefinition = /^ {0,3}\[[^\]]+\]:/m

/** Renders each top-level markdown-it block separately, using the token source maps as block line ranges. */
function markdownBlocks(lines: string[], from = 0): MarkdownBlock[] {
  const tokens = outline.parse(lines.slice(from).join('\n'), {})
  const blocks: MarkdownBlock[] = []
  for (let index = 0; index < tokens.length;) {
    const first = tokens[index]
    let end = index
    if (first.nesting === 1) {
      for (let depth = 0; end < tokens.length; end++) {
        depth += tokens[end].nesting
        if (depth === 0) break
      }
    }
    const group: Token[] = tokens.slice(index, end + 1)
    index = end + 1
    const html = outline.renderer.render(group, outline.options, {}).trim()
    if (!html) continue
    const map = first.map ?? [0, 0]
    blocks.push({start: from + map[0], end: from + map[1], html})
  }
  return blocks
}

export function markdownToHtml(markdown: string): string {
  return markdownBlocks(normalize(markdown).split('\n')).map(block => block.html).join('\n')
}

/**
 * Streams outline markdown as top-level HTML blocks. An update reparses from the last block that may still
 * change (the block at the edge of the unchanged prefix), so streamed text costs one tail parse and the DOM
 * patch keeps every unchanged block.
 */
export class IncrementalMarkdown {
  private lines: string[] = []
  private blocks: MarkdownBlock[] = []
  update(markdown: string): string[] {
    const source = normalize(markdown)
    const next = source.split('\n')
    let shared = 0
    while (shared < next.length && shared < this.lines.length && next[shared] === this.lines[shared]) shared++
    if (shared === next.length && shared === this.lines.length) return this.blocks.map(block => block.html)
    let keep = 0
    if (!referenceDefinition.test(source)) {
      while (keep < this.blocks.length && this.blocks[keep].end < shared) keep++
      // A list, quote or paragraph can absorb lines after its mapped end, so the last retained block is reparsed.
      keep = Math.max(0, keep - 1)
    }
    const from = keep ? this.blocks[keep].start : 0
    this.blocks = [...this.blocks.slice(0, keep), ...markdownBlocks(next, from)]
    this.lines = next
    return this.blocks.map(block => block.html)
  }
}
