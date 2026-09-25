// code-highlight 护栏：
//   1. apps/web 下不得再出现 highlight.js 自带主题样式表的导入（本变更把它换成了 token 着色）
//   2. styles/code-highlight.css 引用的每个 --slax-code-* 都必须在三个主题块里定义（防漂移）
//   3. 代码块只画一层背景：容器承担底色，内部 .hljs 透明（防"容器浅底 + code 深底"叠回来）
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// 不走 import.meta.url（nuxt env 下非 file:// scheme），与 tokens.spec.ts 一致用 cwd = dweb app 根目录
const WEB_ROOT = process.cwd()
const STYLESHEET_PATH = resolve(WEB_ROOT, 'styles/code-highlight.css')
const TOKENS_PATH = resolve(WEB_ROOT, 'styles/theme.tokens.css')

// 已知没有任何页面引用的历史组件，其自带的高亮样式表导入不在本变更范围内
// （见 openspec/changes/eink-code-highlight/proposal.md 的中「不包含」一项）。
// 注意：一旦其中任何一个被接回页面，本护栏不会自动覆盖它 —— 届时必须一并迁移到 token 着色
const DEAD_CODE_EXCLUSIONS = ['app/components/Chat/ChatBot.vue', 'app/components/Chat/BubbleMessage.vue']

const SCAN_DIRS = ['app', 'styles']
const SCAN_EXTENSIONS = ['.vue', '.ts', '.js', '.mjs', '.css', '.scss']
// 只认导入/require 语句，避免注释里提到文件名就误报
const VENDOR_IMPORT = /(?:from\s*|import\s*|require\(\s*)['"]highlight\.js\/styles\//

const collectFiles = (dir: string): string[] => {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectFiles(fullPath))
      continue
    }
    if (SCAN_EXTENSIONS.some(ext => fullPath.endsWith(ext))) {
      files.push(fullPath)
    }
  }
  return files
}

const extractBlock = (css: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? ''
}

describe('code-highlight 护栏', () => {
  it('apps/web 下不存在 highlight.js 自带主题样式表的导入（已知死代码除外）', () => {
    const offenders: string[] = []
    for (const dir of SCAN_DIRS) {
      for (const file of collectFiles(resolve(WEB_ROOT, dir))) {
        const relativePath = file.slice(WEB_ROOT.length + 1)
        if (DEAD_CODE_EXCLUSIONS.includes(relativePath)) continue
        if (VENDOR_IMPORT.test(readFileSync(file, 'utf8'))) {
          offenders.push(relativePath)
        }
      }
    }
    expect(offenders, `以下文件重新引入了第三方高亮样式表：${offenders.join(', ')}`).toEqual([])
  })

  it('styles/code-highlight.css 引用的每个 --slax-code-* token 都在三个主题块中定义', () => {
    const stylesheet = readFileSync(STYLESHEET_PATH, 'utf8')
    const tokens = readFileSync(TOKENS_PATH, 'utf8')
    const referenced = [
      ...new Set([...stylesheet.matchAll(/var\(\s*(--slax-code-[a-z-]+)\s*\)/g)].map(match => match[1] ?? ''))
    ].filter(Boolean)

    expect(referenced.length, 'code-highlight.css 未引用任何 --slax-code-* token').toBeGreaterThan(0)

    for (const selector of [':root', "[data-slax-theme='dark']", "[data-slax-theme='eink']"]) {
      const block = extractBlock(tokens, selector)
      expect(block, `未找到 ${selector} 块`).not.toBe('')
      for (const token of referenced) {
        expect(block, `${selector} 块缺少 ${token}`).toContain(`${token}:`)
      }
    }
  })

  it('代码块只画一层背景：容器承担底色，内部 .hljs 透明', () => {
    const stylesheet = readFileSync(STYLESHEET_PATH, 'utf8')
    const wrapper = extractBlock(stylesheet, 'pre.code-block-wrapper')
    expect(wrapper, '容器必须画 --slax-code-bg').toMatch(/background:\s*var\(--slax-code-bg\)/)

    const base = stylesheet.match(/(?<![\w.-])\.hljs\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    expect(base, '未找到 .hljs 基准规则').not.toBe('')
    expect(base, '.hljs 不得再画第二层背景').toMatch(/background:\s*transparent/)
  })
})
