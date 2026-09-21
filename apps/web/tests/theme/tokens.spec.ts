// theme.tokens.css 静态校验：
//   1. 三主题块（:root / [data-slax-theme='dark'] / [data-slax-theme='eink']）必备 token 完整
//   2. 文件不含任何全局规则（html / body / *），保证安全注入 iframe
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// 不走 import.meta.url（nuxt env 下非 file:// scheme），改用 process.cwd() = dweb app 根目录
const TOKENS_PATH = resolve(process.cwd(), 'styles/theme.tokens.css')
const RAW = readFileSync(TOKENS_PATH, 'utf8')

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
  '--slax-blur'
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
  '--slax-grad-b'
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
