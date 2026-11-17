// @vitest-environment happy-dom
import { TableLayoutProcessor } from '~~/app/components/Article/processors/table-layout.processor'
import { ArticleStyle, type WebProcessorContext } from '~~/app/components/Article/processors/types'
import { afterEach, describe, expect, it, vi } from 'vitest'

function buildContext(html: string): WebProcessorContext {
  const container = document.createElement('div')
  container.innerHTML = `<div class="html-text">${html}</div>`
  return {
    container,
    url: new URL('https://example.com/'),
    articleStyle: ArticleStyle.Default,
    callbacks: {
      screenLockUpdate: () => {},
      showImagePreview: () => {},
      websiteClick: () => {}
    },
    cleanups: []
  }
}

function setDimensions(table: HTMLTableElement, clientWidth: number, scrollWidth: number): void {
  Object.defineProperties(table, {
    clientWidth: { configurable: true, value: clientWidth },
    scrollWidth: { configurable: true, value: scrollWidth }
  })
}

describe('TableLayoutProcessor', () => {
  const originalResizeObserver = window.ResizeObserver

  afterEach(() => {
    window.ResizeObserver = originalResizeObserver
    vi.restoreAllMocks()
  })

  it('hides whitespace-only and nested empty tables without deleting their DOM', () => {
    const ctx = buildContext('<table><tbody><tr><td> \n<br>&nbsp;<table><tbody><tr><td></td></tr></tbody></table></td></tr></tbody></table>')
    const tables = [...ctx.container.querySelectorAll('table')]
    const originalCell = tables[0]!.querySelector('td')
    new TableLayoutProcessor().process(ctx)
    expect(tables.every(table => table.classList.contains('slax-table-empty'))).toBe(true)
    expect(tables[0]!.querySelector('td')).toBe(originalCell)
    expect(ctx.container.querySelectorAll('table')).toHaveLength(2)
    ctx.cleanups.forEach(cleanup => cleanup())
  })

  it.each([
    'Readable text', '<img src="image.png">', '<video></video>', '<audio></audio>',
    '<svg></svg>', '<iframe></iframe>', '<canvas></canvas>', '<picture><img src="image.png"></picture>',
    '<object></object>', '<embed>', '<youtube-player-view></youtube-player-view>',
    '<podcast-player-view></podcast-player-view>', '<unsupported-video></unsupported-video>',
    '<wechat-video-info></wechat-video-info>'
  ])('preserves text and media-only tables: %s', content => {
    const ctx = buildContext(`<table><tbody><tr><td>${content}</td></tr></tbody></table>`)
    new TableLayoutProcessor().process(ctx)
    expect(ctx.container.querySelector('table')!.classList.contains('slax-table-empty')).toBe(false)
    ctx.cleanups.forEach(cleanup => cleanup())
  })

  it('uses native table layout when the content fits', () => {
    const observe = vi.fn()
    const disconnect = vi.fn()
    window.ResizeObserver = class {
      constructor() {}
      observe = observe
      disconnect = disconnect
    } as unknown as typeof ResizeObserver

    const ctx = buildContext('<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>')
    const table = ctx.container.querySelector('table') as HTMLTableElement
    setDimensions(table, 343, 341)

    new TableLayoutProcessor().process(ctx)

    expect(table.classList.contains('slax-table-fit')).toBe(true)
    expect(observe).toHaveBeenCalled()
    expect(ctx.cleanups).toHaveLength(1)
    ctx.cleanups[0]!()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('keeps wide tables in the scrollable layout', () => {
    window.ResizeObserver = class {
      constructor() {}
      observe() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver

    const ctx = buildContext('<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>wide</td><td>data</td></tr></tbody></table>')
    const table = ctx.container.querySelector('table') as HTMLTableElement
    setDimensions(table, 343, 700)

    new TableLayoutProcessor().process(ctx)

    expect(table.classList.contains('slax-table-fit')).toBe(false)
  })

  it('re-measures resize and late content changes without restructuring annotations', () => {
    let onResize!: ResizeObserverCallback
    const disconnect = vi.fn()
    window.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) { onResize = callback }
      observe() {}
      disconnect = disconnect
    } as unknown as typeof ResizeObserver
    const frames = new Map<number, FrameRequestCallback>()
    let sequence = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.set(++sequence, callback)
      return sequence
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
    const resize = () => onResize([], {} as ResizeObserver)
    const paint = () => {
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach(callback => callback(0))
    }
    const ctx = buildContext('<table><tbody><tr><td><mark>saved highlight</mark></td></tr></tbody></table>')
    const table = ctx.container.querySelector('table')!
    const annotation = table.querySelector('mark')!
    const originalParent = table.parentElement
    const originalContents = table.innerHTML
    setDimensions(table, 343, 341)
    new TableLayoutProcessor().process(ctx)

    setDimensions(table, 343, 700)
    resize()
    paint()
    expect(table.classList.contains('slax-table-fit')).toBe(false)
    table.scrollLeft = 80
    resize()
    paint()
    expect(table.scrollLeft).toBe(80)
    expect(table.parentElement).toBe(originalParent)
    expect(table.innerHTML).toBe(originalContents)
    expect(table.querySelector('tbody > tr > td > mark')).toBe(annotation)

    setDimensions(table, 800, 798)
    resize()
    paint()
    expect(table.classList.contains('slax-table-fit')).toBe(true)

    setDimensions(table, 200, 700)
    resize()
    ctx.cleanups.forEach(cleanup => cleanup())
    paint()
    expect(disconnect).toHaveBeenCalledOnce()
    expect(table.classList.contains('slax-table-fit')).toBe(true)
  })
})
