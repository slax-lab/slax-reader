// apps/slax-reader-dweb/tests/theme/fork-tokens.spec.ts
// 静态文本校验 fork.tokens.css 与 uno.config 的双向一致性
// （不走 happy-dom getComputedStyle，参考 upstream tests/theme/tokens.spec.ts）
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// vitest 工作目录是 dweb 项目根（与 upstream tokens.spec.ts:11 同款用 process.cwd()）
const TOKENS_PATH = resolve(process.cwd(), 'app/assets/styles/fork.tokens.css')
const UNO_PATH = resolve(process.cwd(), 'uno.config.ts')
const TOKENS_RAW = readFileSync(TOKENS_PATH, 'utf8')
const UNO_RAW = readFileSync(UNO_PATH, 'utf8')

// 限制：只支持单层 {} 块（如 :root {...} / [data-slax-theme='dark'] {...} 这种扁平选择器块）。
// 不支持嵌套块（@media 内含选择器、@supports 包裹规则等），lazy `[\s\S]*?` 会停在第一个 } 截断。
// fork.tokens.css 设计上只有扁平 :root / [data-slax-theme] 块，不允许嵌套，故安全。
// 如果 Phase 4+ 不得不引入 @media，需要改写本 helper（或拆 token 文件）。
const extractBlock = (raw: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, 'm')
  const match = raw.match(re)
  if (!match || match[1] === undefined) throw new Error(`未找到选择器块：${selector}`)
  return match[1]
}

// 单一源派生集合：所有 it 共用，避免手写常量与源文件漂移
// （Phase 3 code review I1：原版 FORK_TOKENS 常量已删除，:root 块自动枚举）
const FORK_TOKENS_ROOT = extractBlock(TOKENS_RAW, ':root')
const FORK_TOKEN_VARS = [...FORK_TOKENS_ROOT.matchAll(/(--slax-[a-z0-9-]+)\s*:/g)].map(m => m[1]!)

describe('fork.tokens.css 静态校验', () => {
  it('文件存在且非空', () => {
    expect(TOKENS_RAW.length).toBeGreaterThan(0)
  })

  it(':root 块声明的派生变量数量 > 0（防止文件被清空）', () => {
    expect(FORK_TOKEN_VARS.length).toBeGreaterThan(0)
  })

  it(':root 块内每个 fork 变量都有非空右值（允许 var(--slax-*) 派生或 fork-only 字面值）', () => {
    // fork 业务 token 设计原则（spec §3.1 修订版）：
    //   - 优先派生自 upstream var(--slax-*)（设计漂移最小化）
    //   - 当 upstream 无语义对应（如 Dashboard data-viz 青绿色），允许字面值
    //   - **禁止重新声明 upstream 已有 token 名**（由后续 it 校验）
    for (const t of FORK_TOKEN_VARS) {
      const re = new RegExp(`${t}\\s*:\\s*([^;]+);`)
      const m = FORK_TOKENS_ROOT.match(re)
      expect(m, `${t} 没找到右值`).not.toBeNull()
      expect(m![1]!.trim(), `${t} 右值为空`).not.toBe('')
    }
  })

  it('禁止重新声明 upstream 已有的 token 名（spec §3.1 RULE B）', () => {
    // upstream theme.tokens.css 内已存在的 token 名（手动维护，新增 upstream token 时需同步追加）
    // 来源：upstream/apps/slax-reader-dweb/layers/core/styles/theme.tokens.css :root 块
    const UPSTREAM_TOKEN_PREFIXES = [
      'bg',
      'surface',
      'surface-solid',
      'topbar-bg',
      'text',
      'text-muted',
      'text-light',
      'btn-text',
      'accent',
      'accent-soft',
      'accent-bg',
      'danger',
      'danger-bg',
      'selection',
      'border',
      'shadow-warm',
      'shadow-sm',
      'grad-a',
      'grad-b',
      'grad-c',
      'inset-hi',
      'radius',
      'radius-sm',
      'sidebar-w',
      'shell-w',
      'content-w',
      'content-min-w',
      'side-panel-w',
      'header-h-list',
      'header-h-snapshot',
      'header-h-mobile',
      'header-height',
      'font-sans',
      'font-serif',
      'font-mono',
      'fs-display',
      'fs-h2',
      'fs-brand',
      'fs-card',
      'fs-body',
      'fs-meta',
      'fs-aux',
      'fs-tag',
      'ease-spring',
      'dur-normal',
      'dur-fast',
      'blur'
    ]
    const UPSTREAM_TOKENS = new Set(UPSTREAM_TOKEN_PREFIXES.map(p => `--slax-${p}`))
    for (const t of FORK_TOKEN_VARS) {
      expect(UPSTREAM_TOKENS.has(t), `fork.tokens.css 不应重新声明 upstream 已有 token: ${t}`).toBe(false)
    }
  })

  it('文件不含全局规则（html / body / 通配选择器）', () => {
    const stripped = TOKENS_RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(stripped, '禁止 html { ... }').not.toMatch(/(^|[}\s])html\s*\{/m)
    expect(stripped, '禁止 body { ... }').not.toMatch(/(^|[}\s])body\s*\{/m)
    expect(stripped, '禁止 * { ... } 通配').not.toMatch(/(^|[}\s])\*\s*\{/m)
  })
})

describe('uno.config 与 fork.tokens.css 双向一致性（spec §4.8.5）', () => {
  // **关键设计**：派生集合都从「源文件」直接抽，不依赖任何手写常量。
  // 否则 Phase 4 加新 token 时如果漏改 fork.tokens.css 或 uno.config，
  // 一致性 it 可能因常量与源文件漂移而假阳性通过（codex round 1 抓到）。

  // 从 uno.config.ts 内 fork-only bridge 段抽出所有 `'key': 'var(--slax-x)'` 对
  //
  // 合并说明（消除 upstream submodule）：uno.config.ts 现已把 upstream dweb 层的通用桥接
  // （bg/surface/txt/accent/... 对应 styles/theme.tokens.css）与 fork 专属桥接（plan/chart/...
  // 对应 app/assets/styles/fork.tokens.css）合并进同一个 `colors` 对象。两组用不同命名风格
  // （upstream 段是 txt/bg-surface 这种简写，fork 段是与 --slax-* 变量名逐字对应的全名），
  // 不能用同一条正则从整份文件里提取——必须先只截取 fork 段（从注释锚点 FORK_BRIDGE_MARKER
  // 开始到文件结尾），再在该子串里匹配 key/value 对，才能与 fork.tokens.css 的 82 个变量对上。
  const FORK_BRIDGE_MARKER = '// fork 专属 utility 桥接'
  const forkBridgeStart = UNO_RAW.indexOf(FORK_BRIDGE_MARKER)
  if (forkBridgeStart === -1) throw new Error(`未找到 fork 桥接段起始锚点：${FORK_BRIDGE_MARKER}`)
  const forkBridgeRaw = UNO_RAW.slice(forkBridgeStart)
  const bridgeMatches = [...forkBridgeRaw.matchAll(/'([a-z][a-z0-9-]*)':\s*'var\((--slax-[a-z0-9-]+)\)'/g)]
  const bridgeMap = new Map<string, string>(
    bridgeMatches.map(m => [m[2]!, m[1]!]) // slaxVar → utilityKey
  )

  it('集合相等：fork.tokens.css :root 声明的派生变量 === uno.config bridge 桥接变量', () => {
    const declared = [...FORK_TOKEN_VARS].sort()
    const bridged = [...bridgeMap.keys()].sort()
    expect(bridged, '两个集合必须严格相等：1:1 同步').toEqual(declared)
  })

  it('命名约定：每个 bridge utility key === 对应 slaxVar 去掉 --slax- 前缀', () => {
    for (const [slaxVar, utilityKey] of bridgeMap) {
      const expectedKey = slaxVar.replace(/^--slax-/, '')
      expect(utilityKey, `slaxVar=${slaxVar} 应该映射到 utility '${expectedKey}'，实际是 '${utilityKey}'`).toBe(expectedKey)
    }
  })
})
