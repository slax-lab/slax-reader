import MdKatex from '@vscode/markdown-it-katex'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js'
import MarkdownIt, { type MarkdownIt as MarkdownItInstance } from 'markdown-it'
import MdCjkFriendly from 'markdown-it-cjk-friendly'

export const highlightBlock = (str: string, lang?: string) => {
  return `<pre class="code-block-wrapper"><div class="code-block-header"><span class="code-block-header__lang">${lang}</span><span class="code-block-header__copy"></span></div><code class="hljs code-block-body ${lang}">${str}</code></pre>`
}

const escapeBrackets = (text: string) => {
  const pattern = /(```[\s\S]*?```|`.*?`)|\\\[([\s\S]*?[^\\])\\\]|\\\((.*?)\\\)/g
  return text.replace(pattern, (match, codeBlock, squareBracket, roundBracket) => {
    if (codeBlock) return codeBlock
    else if (squareBracket) return `$$${squareBracket}$$`
    else if (roundBracket) return `$${roundBracket}$`
    return match
  })
}

const escapeDollarNumber = (text: string) => {
  let escapedText = ''

  for (let i = 0; i < text.length; i += 1) {
    let char = text[i]
    const nextChar = text[i + 1] || ' '

    if (char === '$' && nextChar >= '0' && nextChar <= '9') char = '\\$'

    escapedText += char
  }

  return escapedText
}

const mermaidLanguage = /^mermaid$/i

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Fences may sit inside a blockquote or a list item, so container markers are
// stripped before matching. Anything the scan cannot place confidently keeps
// its original info string and renders as a code block.
// Known asymmetry: markers are stripped on every line, including lines inside
// an already-open fence, where markdown-it reads the content verbatim. A
// mermaid source line shaped like `- ``` ` therefore counts as a close here
// while markdown-it keeps the fence open; the scan then treats a later fence
// as closed, emits a placeholder for still-arriving content, and hydration
// renders an unfinished diagram (error notice or a diagram that changes as
// streaming continues). Remembering the opener's container context would fix
// this, but real model output essentially never contains such lines, and the
// stripping cannot be dropped for closers because blockquote-nested fences
// need it — accepted and recorded here.
const containerMarkers = /^(?: {0,3}>[ \t]?| {0,3}[-*+][ \t]+| {0,3}\d{1,9}[.)][ \t]+)*/
const fenceLinePattern = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)/

// markdown-it closes an unterminated fence at the end of the input, so the
// highlight callback cannot tell a still-streaming mermaid fence from a
// finished one. Drop the info string of an unclosed mermaid fence before
// rendering so the fence takes the plain code-block path.
const downgradeUnclosedMermaidFences = (text: string) => {
  const lines = text.split('\n')
  let openFence: { index: number; marker: string; mermaid: boolean } | null = null

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const match = fenceLinePattern.exec(line.replace(containerMarkers, ''))
    if (!match) continue

    const marker = match[2] ?? ''
    const info = (match[3] ?? '').trim()

    if (openFence) {
      const closes = marker[0] === openFence.marker[0] && marker.length >= openFence.marker.length && info === ''
      if (closes) openFence = null
      continue
    }

    if (marker[0] === '`' && info.includes('`')) continue

    openFence = { index, marker, mermaid: mermaidLanguage.test(info.split(/\s+/)[0] ?? '') }
  }

  if (!openFence?.mermaid) return text

  const line = lines[openFence.index] ?? ''
  const markerIndex = line.indexOf(openFence.marker)
  if (markerIndex === -1) return text

  lines[openFence.index] = `${line.slice(0, markerIndex)}${openFence.marker}${line.endsWith('\r') ? '\r' : ''}`
  return lines.join('\n')
}

// The plugin runtime supports Markdown It 15, but its published declarations
// still reference the separate Markdown It 14 types package.
const mdKatexPlugin = MdKatex as unknown as (md: MarkdownItInstance) => void

const createMarkdownRenderer = (mermaid: boolean) => {
  const renderer = new MarkdownIt({
    html: true,
    linkify: true,
    highlight(code, language) {
      if (mermaid && language && mermaidLanguage.test(language)) {
        return `<div class="mermaid-placeholder">${escapeHtml(code)}</div>`
      }

      const validLang = !!(language && hljs.getLanguage(language))
      if (validLang) {
        const lang = language ?? ''
        return highlightBlock(hljs.highlight(code, { language: lang }).value, lang)
      }
      return highlightBlock(hljs.highlightAuto(code).value, '')
    }
  })

  const defaultLinkOpen = renderer.renderer.rules.link_open ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options))
  renderer.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const token = tokens[index]
    if (!token) return defaultLinkOpen(tokens, index, options, env, self)
    if (!token.attrGet('target')) token.attrSet('target', '_blank')
    if (!token.attrGet('rel')) token.attrSet('rel', 'noopener')
    return defaultLinkOpen(tokens, index, options, env, self)
  }

  // 修复 CJK 加粗：** 紧邻全角标点
  // 时无法闭合，导致加粗失效
  renderer.use(MdCjkFriendly).use(mdKatexPlugin)

  return renderer
}

// One renderer per mermaid mode: the highlight callback is bound to the
// renderer, so the mode cannot be switched per call on a shared instance.
const markdownRenderers = new Map<boolean, MarkdownItInstance>()

const getMarkdownRenderer = (mermaid: boolean) => {
  let renderer = markdownRenderers.get(mermaid)
  if (!renderer) {
    renderer = createMarkdownRenderer(mermaid)
    markdownRenderers.set(mermaid, renderer)
  }
  return renderer
}

export interface ParseMarkdownOptions {
  // Emits a hydration placeholder for closed mermaid fences instead of a code
  // block. Opt-in, because a surface that never hydrates would otherwise lose
  // the code-block rendering (language header, copy affordance) for diagrams.
  mermaid?: boolean
}

// 转换markdown内容
export const parseMarkdownText = (text: string, options: ParseMarkdownOptions = {}) => {
  const { mermaid = false } = options
  const escapedText = escapeBrackets(escapeDollarNumber(text))
  const fenceSafeText = mermaid ? downgradeUnclosedMermaidFences(escapedText) : escapedText
  return DOMPurify.sanitize(getMarkdownRenderer(mermaid).render(fenceSafeText))
}

// 从markdown中提取JSON文本
export const extractJsonFromMarkdown = (mdText: string) => {
  // 匹配代码块中的文本
  const regex = /```json\n([\s\S]*?)\n```/g
  const matches = regex.exec(mdText)
  if (matches && matches[1]) {
    // 尝试将提取的文本转换为JSON对象
    try {
      const jsonObj = JSON.parse(matches[1])
      return jsonObj
    } catch (error) {
      console.log(matches[1])
      console.error('Parsing Error:', error)
      return null
    }
  } else {
    // 没有匹配的话不排除可以直接解析
    try {
      const jsonObj = JSON.parse(mdText)
      return jsonObj
    } catch (error) {
      console.error('Parsing Original Text Error:', error)
    }
    console.log('No matching JSON found in the markdown text.')
    return null
  }
}

// 转换残缺的json列表数据
export const parseIncompleteJSONListText = (text: string) => {
  try {
    let cleanedText = text.trim().replace(/,\s*\{[^{}]*$/, '')
    if (cleanedText.length === text.length) {
      if (cleanedText.indexOf('{') !== -1 && cleanedText.indexOf('}') === -1) {
        // json 列表中第一个数据还没生成好的情况，因为第一个数据前面不会有逗号所以上面的正则会检测不出来
        cleanedText = text.trim().replace(/\s*\{[^{}]*$/, '\n')
      }
    }

    const regex = /```json\n([\s\S]*?)\n/g
    const matches = regex.exec(cleanedText)

    if (matches && matches[1]) {
      const objects = JSON.parse(`${cleanedText.replace('```json', '')}]`)
      return objects
    } else {
      const objects = JSON.parse(`${cleanedText}]`)
      return objects
    }
  } catch (error) {
    console.error(error)
    return null
  }
}

// 用于从文本解析出带# ，##，- 的markdown内容
export const extractMarkdownFromText = (text: string) => {
  if (!text) {
    return text
  }

  // 使用正则表达式匹配以 # 或 ## 开头的标题，以及以 - 开头的列表项。
  // ^ 表示行的开始，[ \t]* 匹配可能存在的空格或制表符
  const markdownRegex = /^(#[#]?[ \t]+.*|[ \t]*-[ \t]+.+)$/gm

  // 使用match方法进行全局匹配
  const matches = text.match(markdownRegex)

  // 如果没有找到匹配的内容，返回一个空字符串
  if (!matches) {
    return ''
  }

  // 返回匹配到的所有行
  return matches.join('\n')
}

// 从HTML中提取文本内容
export const extractHTMLTextContent = (htmlString: string) => {
  // 移除 HTML 标签
  return htmlString
    .replace(/<[^>]*>/g, '') // 替换所有标签
    .replace(/\s+/g, ' ') // 将多个空格替换为一个空格
    .trim() // 移除首尾空格
}
