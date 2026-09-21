import { findBestMatch } from '@commons/utils/search'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// happy-dom 无真实布局，打桩 offset 值模拟可见
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 1 })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 1 })
})

afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight')
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth')
})

describe('findBestMatch', () => {
  const anchor = 'You need pressure. Tactical stress.'

  it('matches text that is contiguous within a single text node with 0 errors', () => {
    const container = document.createElement('div')
    container.innerHTML = `<p>${anchor}</p>`

    const result = findBestMatch(anchor, container)
    expect(result?.match.errors).toBe(0)
  })

  it('matches text split across a <br> line break with 0 errors', () => {
    const container = document.createElement('div')
    container.innerHTML = '<p>You need pressure.<br>Tactical stress.</p>'

    const result = findBestMatch(anchor, container)
    expect(result?.match.errors).toBe(0)
  })

  it('matches text split across adjacent block elements with 0 errors', () => {
    const container = document.createElement('div')
    container.innerHTML = '<p>You need pressure.</p><p>Tactical stress.</p>'

    const result = findBestMatch(anchor, container)
    expect(result?.match.errors).toBe(0)
  })

  it('does not match text embedded in a <script> payload (e.g. Nuxt hydration data), preferring the visible DOM occurrence', () => {
    const container = document.createElement('div')
    // 模拟水合 JSON 里的原文
    container.innerHTML = `
      <script type="application/json">${JSON.stringify({ outline: anchor })}</script>
      <article><p>You need pressure.<br>Tactical stress.</p></article>
    `

    const result = findBestMatch(anchor, container)
    expect(result?.element.tagName).not.toBe('SCRIPT')
    expect(result?.element.closest('article')).not.toBeNull()
  })

  it('produces a match range whose raw offsets are valid within element.textContent', () => {
    const container = document.createElement('div')
    container.innerHTML = '<p>You need pressure.</p><p>Tactical stress.</p>'

    const result = findBestMatch(anchor, container)
    expect(result).not.toBeNull()
    const slice = result!.element.textContent!.slice(result!.match.start, result!.match.end)
    // DOM 里没空格，少 1 个字符
    expect(slice).toBe('You need pressure.Tactical stress.')
  })

  it('keeps raw offsets aligned when an emoji (non-BMP, 2 UTF-16 code units) precedes the match in the same element', () => {
    const container = document.createElement('div')
    // emoji 与命中文本同元素
    container.innerHTML = `<p>😀 ${anchor}</p>`

    const result = findBestMatch(anchor, container)
    expect(result).not.toBeNull()
    expect(result!.match.errors).toBe(0)
    const slice = result!.element.textContent!.slice(result!.match.start, result!.match.end)
    expect(slice).toBe(anchor)
  })

  it('does not produce an out-of-bounds (undefined) end offset when an emoji precedes an exact match', () => {
    // exact 路径最易暴露码点计数错位
    const container = document.createElement('div')
    container.innerHTML = '<p>😀 abc</p>'

    const result = findBestMatch('abc', container, false)
    expect(result).not.toBeNull()
    expect(result!.match.start).not.toBeUndefined()
    expect(result!.match.end).not.toBeUndefined()
    expect(result!.element.textContent!.slice(result!.match.start, result!.match.end)).toBe('abc')
  })

  it('produces a valid (non-undefined) end offset when the match exactly fills a cached leaf element', () => {
    // 命中区间刚好到元素内容末尾
    const container = document.createElement('div')
    container.innerHTML = '<ul><li><strong>Systems thinking</strong> - more text after it.</li></ul>'

    const result = findBestMatch('Systems thinking', container)
    expect(result).not.toBeNull()
    expect(result!.match.end).not.toBeUndefined()
    expect(result!.element.textContent!.slice(result!.match.start, result!.match.end)).toBe('Systems thinking')
  })

  it('produces the same result whether a subtree is visited directly or reached through a wrapping ancestor first (subtree-text cache)', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <section>
        <div><p>unrelated filler text here</p></div>
        <article><p>You need pressure.</p><p>Tactical stress.</p></article>
      </section>
    `

    const result = findBestMatch(anchor, container)
    expect(result).not.toBeNull()
    expect(result!.match.errors).toBe(0)
    const slice = result!.element.textContent!.slice(result!.match.start, result!.match.end)
    expect(slice).toBe('You need pressure.Tactical stress.')
  })
})
