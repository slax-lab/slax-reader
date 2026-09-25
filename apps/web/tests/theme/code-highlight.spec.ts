// code-highlight 护栏：
//   1. apps/web 下不得再出现 highlight.js 自带主题样式表的导入（本变更把它换成了 token 着色；允许清单见下）
//   2. styles/code-highlight.css 引用的每个 --slax-code-* 都必须在三个主题块里定义（防漂移）
//   3. 代码块只画一层背景：容器承担底色，内部 .hljs 透明（防"容器浅底 + code 深底"叠回来）
//   4. wrapper 内部的文字（语言标签）必须显式取色，不能继承页面正文色（防深字压深底）
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// 不走 import.meta.url（nuxt env 下非 file:// scheme），与 tokens.spec.ts 一致用 cwd = dweb app 根目录
const WEB_ROOT = process.cwd()
const STYLESHEET_PATH = resolve(WEB_ROOT, 'styles/code-highlight.css')
const TOKENS_PATH = resolve(WEB_ROOT, 'styles/theme.tokens.css')

// 允许清单：web 的 Chat/ChatBot.vue 与 BubbleMessage.vue 不被任何页面或组件引用，只被各自的单测 import
// （ChatBot.vue 自带 `highlight.js/styles/base16/equilibrium-gray-light.css`；BubbleMessage.vue 没有任何 vendor 导入，
//   所以它不需要豁免）。把 ChatBot.vue 接回页面时必须一并迁移到 token 着色：删掉这一条，护栏就会覆盖它。
const VENDOR_IMPORT_EXEMPTIONS = ['app/components/Chat/ChatBot.vue']

// 扫描 app / styles / tests 三处：被接回页面的组件，其 vendor 导入往往先在 tests 里出现
const SCAN_DIRS = ['app', 'styles', 'tests']
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
  it('apps/web 下不存在 highlight.js 自带主题样式表的导入（允许清单除外）', () => {
    const offenders: string[] = []
    for (const dir of SCAN_DIRS) {
      for (const file of collectFiles(resolve(WEB_ROOT, dir))) {
        const relativePath = file.slice(WEB_ROOT.length + 1)
        if (VENDOR_IMPORT_EXEMPTIONS.includes(relativePath)) continue
        if (VENDOR_IMPORT.test(readFileSync(file, 'utf8'))) {
          offenders.push(relativePath)
        }
      }
    }
    expect(
      offenders,
      `以下文件重新引入了第三方高亮样式表：${offenders.join(', ')}` +
        `（若这是被接回页面的 Chat/ChatBot.vue，请同时删除 VENDOR_IMPORT_EXEMPTIONS 里的豁免）`
    ).toEqual([])
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

  it('wrapper 内的语言标签显式取色，不继承页面正文色', () => {
    const stylesheet = readFileSync(STYLESHEET_PATH, 'utf8')
    const header = extractBlock(stylesheet, '.code-block-header')
    expect(header, '未找到 .code-block-header 规则').not.toBe('')
    expect(
      header,
      '语言标签落在代码块底色上，必须显式取 --slax-code-text；继承页面正文色会在 light 下变成深字压深底'
    ).toMatch(/color:\s*var\(--slax-code-text\)/)
  })
})
