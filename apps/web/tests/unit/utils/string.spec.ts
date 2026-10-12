// 测 urlBase64ToUint8Array：base64url → Uint8Array 解码
// 覆盖点：标准转换、padding 补齐、特殊字符替换、空字符串、返回类型
import { truncateTitle, urlBase64ToUint8Array } from '~~/app/utils/string'

import { describe, expect, it } from 'vitest'

// 视觉宽度口径：中文记 2，其余记 1，预算 = max * 2
// 有调用方按字符数断言过，契约改动必须由这里挡住
describe('truncateTitle', () => {
  it('未超预算原样返回', () => {
    expect(truncateTitle('A'.repeat(96))).toBe('A'.repeat(96))
    expect(truncateTitle('中'.repeat(48))).toBe('中'.repeat(48))
  })

  it('拉丁超 96 才截断', () => {
    const out = truncateTitle('A'.repeat(120))
    expect(out).toBe(`${'A'.repeat(96)}…`)
  })

  it('中文超 48 就截断', () => {
    const out = truncateTitle('中'.repeat(60))
    expect(out).toBe(`${'中'.repeat(48)}…`)
  })

  it('中英混排按宽度累加', () => {
    // 40 中文 = 80 宽度，余 16 宽度给拉丁
    const input = '中'.repeat(40) + 'A'.repeat(30)
    expect(truncateTitle(input)).toBe(`${'中'.repeat(40)}${'A'.repeat(16)}…`)
  })

  it('max 可覆盖', () => {
    expect(truncateTitle('A'.repeat(30), 10)).toBe(`${'A'.repeat(20)}…`)
  })

  it('空值与 null 返回空串', () => {
    expect(truncateTitle('')).toBe('')
    expect(truncateTitle(null)).toBe('')
    expect(truncateTitle(undefined)).toBe('')
  })

  it('按码点切分，不截断 emoji', () => {
    // emoji 不在 CJK_REGEX 内，各记 1 宽度，故 120 个才超预算
    const out = truncateTitle('😀'.repeat(120))
    expect(out).toBe(`${'😀'.repeat(96)}…`)
    // Array.from 保证代理对不被切半，不出现孤立代理
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out)).toBe(false)
  })
})

describe('urlBase64ToUint8Array', () => {
  it('标准 base64url 字符串解码字节正确', () => {
    // 'Hello' 的 base64 是 'SGVsbG8=', base64url 为 'SGVsbG8'
    const result = urlBase64ToUint8Array('SGVsbG8')
    expect(Array.from(result)).toEqual([72, 101, 108, 108, 111])
  })

  it("base64url 特殊字符 '-' '_' 替换为 '+' '/' 后解码", () => {
    // base64url '-_A' → 替换为 '+/A' → 补 padding '+/A=' → 解码为 [251, 240]
    const result = urlBase64ToUint8Array('-_A')
    expect(Array.from(result)).toEqual([251, 240])
  })

  it('长度不是 4 的倍数时自动补 padding', () => {
    // 'SGk' 长度 3，需补 1 个 '=' 才能 atob，应该返回 'Hi'
    const result = urlBase64ToUint8Array('SGk')
    expect(Array.from(result)).toEqual([72, 105]) // 'Hi'
  })

  it('空字符串返回长度为 0 的 Uint8Array', () => {
    const result = urlBase64ToUint8Array('')
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(0)
  })

  it('返回值是 Uint8Array 实例（不是普通 Array）', () => {
    const result = urlBase64ToUint8Array('SGk')
    expect(result).toBeInstanceOf(Uint8Array)
  })
})
