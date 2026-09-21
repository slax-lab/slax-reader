import MdKatex from '@vscode/markdown-it-katex'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js'
import MarkdownIt from 'markdown-it'
import MdCjkFriendly from 'markdown-it-cjk-friendly'

const highlightBlock = (str: string, lang?: string) => {
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

const mdi = new MarkdownIt({
  html: true,
  linkify: true,
  highlight(code, language) {
    const validLang = !!(language && hljs.getLanguage(language))
    if (validLang) {
      const lang = language ?? ''
      return highlightBlock(hljs.highlight(code, { language: lang }).value, lang)
    }
    return highlightBlock(hljs.highlightAuto(code).value, '')
  }
})

const defaultLinkOpen = mdi.renderer.rules.link_open ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options))
mdi.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index]
  if (!token) return defaultLinkOpen(tokens, index, options, env, self)
  if (!token.attrGet('target')) token.attrSet('target', '_blank')
  if (!token.attrGet('rel')) token.attrSet('rel', 'noopener')
  return defaultLinkOpen(tokens, index, options, env, self)
}

// The plugin runtime supports Markdown It 15, but its published declarations
// still reference the separate Markdown It 14 types package.
const mdKatexPlugin = MdKatex as unknown as (md: typeof mdi) => void

// 修复 CJK 加粗：** 紧邻全角标点
// 时无法闭合，导致加粗失效
mdi.use(MdCjkFriendly).use(mdKatexPlugin)

// 转换markdown内容
export const parseMarkdownText = (text: string) => {
  const escapedText = escapeBrackets(escapeDollarNumber(text))
  return DOMPurify.sanitize(mdi.render(escapedText))
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
