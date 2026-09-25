// theme.tokens.css 静态校验：
//   1. 三主题块（:root / [data-slax-theme='dark'] / [data-slax-theme='eink']）必备 token 完整
//   2. 文件不含任何全局规则（html / body / *），保证安全注入 iframe
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// 不走 import.meta.url（nuxt env 下非 file:// scheme），改用 process.cwd() = dweb app 根目录
const TOKENS_PATH = resolve(process.cwd(), 'styles/theme.tokens.css')
const RAW = readFileSync(TOKENS_PATH, 'utf8')

// 代码块 token（highlight.js token 映射；定义见 styles/theme.tokens.css，着色见 styles/code-highlight.css）：
// 三主题必须各自齐备，缺一个即失败 —— 不允许静默回落到别的主题的值。
// E-ink 下的深色代码块正是"没有主题分支、直接吃第三方样式表默认值"造成的
const CODE_REQUIRED_TOKENS = [
  '--slax-code-bg',
  '--slax-code-text',
  '--slax-code-border',
  '--slax-code-comment',
  '--slax-code-keyword',
  '--slax-code-tag',
  '--slax-code-literal',
  '--slax-code-string',
  '--slax-code-number',
  '--slax-code-symbol',
  '--slax-code-builtin'
]

// :root 必备的全部 token（含主题独立的尺寸 / 字体 / 渐变备份）
const ROOT_REQUIRED_TOKENS = [
  '--slax-bg',
  '--slax-surface',
  '--slax-surface-solid',
  '--slax-text',
  '--slax-text-muted',
  '--slax-text-light',
  '--slax-btn-text',
  '--slax-accent',
  '--slax-accent-soft',
  '--slax-accent-bg',
  '--slax-danger',
  '--slax-danger-bg',
  '--slax-border',
  '--slax-selection',
  '--slax-shadow-warm',
  '--slax-shadow-sm',
  '--slax-shadow-modal',
  '--slax-radius',
  '--slax-radius-sm',
  '--slax-grad-a',
  '--slax-grad-b',
  '--slax-blur',
  ...CODE_REQUIRED_TOKENS
]

// 主题块（dark / eink）必须 override 的核心颜色 token；尺寸 / 字体 / 部分阴影从 :root 继承
const THEME_REQUIRED_TOKENS = [
  '--slax-bg',
  '--slax-surface',
  '--slax-surface-solid',
  '--slax-text',
  '--slax-text-muted',
  '--slax-text-light',
  '--slax-btn-text',
  '--slax-accent',
  '--slax-accent-soft',
  '--slax-danger',
  '--slax-border',
  '--slax-selection',
  '--slax-shadow-warm',
  '--slax-shadow-sm',
  '--slax-shadow-modal',
  '--slax-grad-a',
  '--slax-grad-b',
  ...CODE_REQUIRED_TOKENS
]

const ROOT_ONLY_TOKENS = [
  '--slax-header-height',
  '--slax-content-min-w',
  '--slax-side-panel-w',
  '--slax-side-panel-min-w',
  '--slax-side-panel-max-w',
  '--slax-push-amount',
  '--slax-fs-display',
  '--slax-fs-h2',
  '--slax-fs-brand',
  '--slax-fs-card',
  '--slax-fs-body',
  '--slax-fs-meta',
  '--slax-fs-aux',
  '--slax-fs-tag',
  '--slax-font-sans',
  '--slax-font-serif',
  '--slax-font-mono',
  '--slax-ease-spring',
  '--slax-dur-normal',
  '--slax-dur-fast'
]

// E-ink 必须显式 override 的 token：blur 在 :root 是 blur(16px) saturate(150%)，
// E-ink 必须置 none 以禁用毛玻璃残影
const EINK_OVERRIDE_TOKENS = ['--slax-blur']

const extractBlock = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, 'm')
  const match = RAW.match(re)
  if (!match || match[1] === undefined) throw new Error(`未找到选择器块：${selector}`)
  return match[1]
}

describe('theme.tokens.css 静态校验', () => {
  it('文件存在且非空', () => {
    expect(RAW.length).toBeGreaterThan(0)
  })

  it(':root 块包含全部必备 token + 仅根块独有 token', () => {
    const root = extractBlock(':root')
    for (const t of ROOT_REQUIRED_TOKENS) {
      expect(root, `:root 缺失 ${t}`).toContain(t)
    }
    for (const t of ROOT_ONLY_TOKENS) {
      expect(root, `:root 缺失独有 token ${t}`).toContain(t)
    }
  })

  it("[data-slax-theme='dark'] 块覆盖全部必备颜色 token", () => {
    const dark = extractBlock("[data-slax-theme='dark']")
    for (const t of THEME_REQUIRED_TOKENS) {
      expect(dark, `dark 缺失 ${t}`).toContain(t)
    }
  })

  it("[data-slax-theme='eink'] 块覆盖全部必备颜色 token", () => {
    const eink = extractBlock("[data-slax-theme='eink']")
    for (const t of THEME_REQUIRED_TOKENS) {
      expect(eink, `eink 缺失 ${t}`).toContain(t)
    }
  })

  it('文件不含全局规则（html / body / 通配选择器）', () => {
    // 该文件会被注入到用户原网页 iframe，含全局规则会污染原页面
    // 注释里出现 html / body 文本是允许的，正则只匹配选择器位置（行首或 } 后空白）
    const stripped = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(stripped, '禁止 html { ... }').not.toMatch(/(^|[\}\s])html\s*\{/m)
    expect(stripped, '禁止 body { ... }').not.toMatch(/(^|[\}\s])body\s*\{/m)
    expect(stripped, '禁止 * { ... } 通配').not.toMatch(/(^|[\}\s])\*\s*\{/m)
  })

  it('文件不含 ::view-transition-* / @media 等仅主站需要的规则', () => {
    // 注释里出现 @media / ::view-transition 字样是允许的（如解释为什么放在 theme.css 而不是这里），
    // 仅断言 CSS 规则位置不出现这些 at-rule / pseudo
    const stripped = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(stripped, '禁止 ::view-transition-* 伪元素').not.toContain('::view-transition')
    expect(stripped, '禁止 @media 媒体查询').not.toContain('@media')
    expect(stripped, '禁止 @keyframes 动画').not.toContain('@keyframes')
  })

  it('dark / eink 块不重复声明 :root 独有的尺寸 token (避免 layout 抖动)', () => {
    // --slax-header-height / --slax-content-min-w / --slax-side-panel-w / 字体族
    // 设计上仅 :root 一次，dark / eink 不应 override
    const dark = extractBlock("[data-slax-theme='dark']")
    const eink = extractBlock("[data-slax-theme='eink']")
    for (const t of ROOT_ONLY_TOKENS) {
      expect(dark, `dark 不应重复声明 ${t}`).not.toContain(t)
      expect(eink, `eink 不应重复声明 ${t}`).not.toContain(t)
    }
  })

  it("[data-slax-theme='eink'] 块必须显式 override --slax-blur 为 none", () => {
    // theme.css 内 `[data-slax-theme='eink'] *` 通配规则会禁用 backdrop-filter，
    // 但若有写法直接消费 var(--slax-blur)（绕过通配的内联 / 行内场景），
    // E-ink 仍会落到 :root 的 blur(16px) 值。强制 eink 块 override --slax-blur: none 兜住此情况
    const eink = extractBlock("[data-slax-theme='eink']")
    for (const t of EINK_OVERRIDE_TOKENS) {
      expect(eink, `eink 必须 override ${t}`).toContain(t)
    }
    expect(eink, 'eink --slax-blur 必须为 none').toMatch(/--slax-blur:\s*none/)
  })

  it("[data-slax-theme='eink'] 块必须把三档阴影 token 全部置 none", () => {
    // E-ink 无阴影是硬规则；shadow-modal 含字面投影 0 20px 60px，
    // 若 eink 不显式置 none 会回落到 light 值，在墨水屏渲染出投影
    const eink = extractBlock("[data-slax-theme='eink']")
    expect(eink, 'eink --slax-shadow-warm 必须为 none').toMatch(/--slax-shadow-warm:\s*none/)
    expect(eink, 'eink --slax-shadow-sm 必须为 none').toMatch(/--slax-shadow-sm:\s*none/)
    expect(eink, 'eink --slax-shadow-modal 必须为 none').toMatch(/--slax-shadow-modal:\s*none/)
  })
})

// ---- 代码块 token 校验 ----
// 需求来源：specs/code-highlight-theming —— E-ink 纸面化（表面 / 边框 / 正文色与文章代码块一致、
// 无深色填充、无半透明）、语法色无彩色且过 4.5:1 对比度下限；light / dark 取色值保持变更前不变

const EINK_SYNTAX_TOKENS = [
  '--slax-code-comment',
  '--slax-code-keyword',
  '--slax-code-tag',
  '--slax-code-literal',
  '--slax-code-string',
  '--slax-code-number',
  '--slax-code-symbol',
  '--slax-code-builtin'
]

// 变更前 light / dark 的取色（Atom One Dark），逐字节保持不变是本次变更的兼容性承诺
const INCUMBENT_CODE_TOKENS: Record<string, string> = {
  '--slax-code-bg': '#282c34',
  '--slax-code-text': '#abb2bf',
  '--slax-code-border': 'transparent',
  '--slax-code-comment': '#5c6370',
  '--slax-code-keyword': '#c678dd',
  '--slax-code-tag': '#e06c75',
  '--slax-code-literal': '#56b6c2',
  '--slax-code-string': '#98c379',
  '--slax-code-number': '#d19a66',
  '--slax-code-symbol': '#61aeee',
  '--slax-code-builtin': '#e6c07b'
}

const tokenValue = (block: string, name: string): string => {
  const matched = block.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))
  const value = matched?.[1]?.trim()
  if (!value) throw new Error(`未找到 token：${name}`)
  return value
}

const parseHex = (value: string): [number, number, number] => {
  const matched = value.match(/^#([0-9a-fA-F]{6})$/)
  if (!matched?.[1]) throw new Error(`不是 6 位 hex 颜色：${value}`)
  const int = Number.parseInt(matched[1], 16)
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff]
}

const channelLuminance = (channel: number): number => {
  const scaled = channel / 255
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
}

const relativeLuminance = ([r, g, b]: [number, number, number]): number =>
  0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)

const contrastRatio = (foreground: string, background: string): number => {
  const a = relativeLuminance(parseHex(foreground))
  const b = relativeLuminance(parseHex(background))
  return a >= b ? (a + 0.05) / (b + 0.05) : (b + 0.05) / (a + 0.05)
}

describe('theme.tokens.css 代码块 token 校验', () => {
  const root = extractBlock(':root')
  const dark = extractBlock("[data-slax-theme='dark']")
  const eink = extractBlock("[data-slax-theme='eink']")
  const einkCodeBg = tokenValue(eink, '--slax-code-bg')

  it('light / dark 取色值保持变更前不变（兼容性承诺）', () => {
    for (const [token, value] of Object.entries(INCUMBENT_CODE_TOKENS)) {
      expect(tokenValue(root, token), `:root ${token} 取色值被改动`).toBe(value)
      expect(tokenValue(dark, token), `dark ${token} 取色值被改动`).toBe(value)
    }
  })

  it('E-ink 代码块底色 / 正文色 / 边框与文章代码块同款（纸面，无深色填充）', () => {
    // 文章代码块（styles/article/_content-mixin.scss）消费 --slax-surface + --slax-border，
    // 两者取同一份值才能保证同一屏上并排的两个代码块不打架
    expect(einkCodeBg, 'eink 代码块底色必须等于主题 surface').toBe(tokenValue(eink, '--slax-surface'))
    expect(tokenValue(eink, '--slax-code-text'), 'eink 代码块正文色必须等于主题正文色').toBe(tokenValue(eink, '--slax-text'))
    expect(tokenValue(eink, '--slax-code-border'), 'eink 代码块边框必须等于主题边框色').toBe(tokenValue(eink, '--slax-border'))
  })

  it('E-ink 代码块不出现半透明颜色', () => {
    for (const token of ['--slax-code-bg', '--slax-code-text', '--slax-code-border', ...EINK_SYNTAX_TOKENS]) {
      const value = tokenValue(eink, token)
      expect(value, `${token} 不得使用 rgba(`).not.toContain('rgba(')
      expect(value, `${token} 不得使用 color-mix(`).not.toContain('color-mix(')
    }
  })

  it('E-ink 语法色全为灰阶（R = G = B），不靠色相区分', () => {
    for (const token of EINK_SYNTAX_TOKENS) {
      const [r, g, b] = parseHex(tokenValue(eink, token))
      expect([r, g, b], `${token} 必须是灰阶`).toEqual([r, r, r])
    }
  })

  it('E-ink 语法色与正文色对代码块底色的对比度均 ≥ 4.5:1', () => {
    for (const token of ['--slax-code-text', ...EINK_SYNTAX_TOKENS]) {
      const ratio = contrastRatio(tokenValue(eink, token), einkCodeBg)
      expect(ratio, `${token} 对比度 ${ratio.toFixed(2)}:1 低于 4.5:1`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
