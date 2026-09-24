import { nextTick } from 'vue'

import MermaidDiagramOverlay from '~~/app/components/Mermaid/MermaidDiagramOverlay.vue'

import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A 200x100 viewBox keeps the fitted scale at 1 for any sane test viewport, so
// the assertions below can use absolute percentages and pixel sizes.
const svgMarkup = '<svg viewBox="0 0 200 100"><g><text>diagram</text></g></svg>'

let mounted: ReturnType<typeof mountWithApp<typeof MermaidDiagramOverlay>>[] = []

// The overlay teleports to body, so its markup is queried from the document
// rather than from the wrapper's own tree.
const overlayEl = () => document.querySelector<HTMLElement>('.mermaid-overlay')
const canvasEl = () => document.querySelector<HTMLElement>('.mermaid-overlay-canvas')
const toolbarBtn = (label: string) => overlayEl()!.querySelector<HTMLElement>(`button[aria-label="${label}"]`)!
const scaleText = () => document.querySelector('.mermaid-overlay-scale')?.textContent
const canvasWidth = () => canvasEl()?.style.width
const canvasTransform = () => canvasEl()?.style.transform

// The fitted size is applied from onMounted, so the style binding lands on the
// tick after mount.
const mountOverlay = async (svg: string = svgMarkup, onClose?: () => void) => {
  const wrapper = mountWithApp(MermaidDiagramOverlay, {
    props: { svg, ...(onClose ? { onClose } : {}) },
    attachTo: document.body
  })
  mounted.push(wrapper)
  await nextTick()
  return wrapper
}

const click = (element: Element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))

const drag = (from: { x: number; y: number }, to: { x: number; y: number }) => {
  const canvas = canvasEl()!
  canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: from.x, clientY: from.y, pointerId: 1, bubbles: true }))
  canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: to.x, clientY: to.y, pointerId: 1, bubbles: true }))
  canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: to.x, clientY: to.y, pointerId: 1, bubbles: true }))
}

const wheel = (deltaY: number) => overlayEl()!.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }))

const pressEscape = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

const closes = (wrapper: Awaited<ReturnType<typeof mountOverlay>>) => wrapper.emitted('close') ?? []

describe('MermaidDiagramOverlay.vue', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    mounted.forEach(wrapper => wrapper.unmount())
    mounted = []
    document.body.innerHTML = ''
  })

  describe('A. 渲染', () => {
    it('A1: teleports the overlay with the diagram markup to body', async () => {
      await mountOverlay()
      expect(overlayEl()).not.toBeNull()
      expect(canvasEl()?.querySelector('svg text')?.textContent).toBe('diagram')
    })

    it('A2: opens at the fitted scale derived from the viewBox', async () => {
      await mountOverlay()
      expect(scaleText()).toBe('100%')
      expect(canvasWidth()).toBe('200px')
      expect(canvasEl()?.style.height).toBe('100px')
    })

    it('A3: falls back to intrinsic sizing when the svg has no viewBox', async () => {
      await mountOverlay('<svg width="200" height="100"><g /></svg>')
      expect(canvasEl()?.classList.contains('mermaid-overlay-canvas--unsized')).toBe(false)
      expect(canvasWidth()).toBe('200px')

      document.body.innerHTML = ''
      await mountOverlay('<svg><g /></svg>')
      expect(canvasEl()?.classList.contains('mermaid-overlay-canvas--unsized')).toBe(true)
      expect(canvasWidth()).toBe('')
      expect(canvasTransform()).toContain('scale(1)')
    })
  })

  describe('B. 缩放', () => {
    it('B1: zoom in / zoom out buttons rescale the canvas', async () => {
      await mountOverlay()
      click(toolbarBtn('Zoom in'))
      await nextTick()
      expect(scaleText()).toBe('125%')
      expect(canvasWidth()).toBe('250px')

      click(toolbarBtn('Zoom out'))
      await nextTick()
      expect(scaleText()).toBe('100%')
      expect(canvasWidth()).toBe('200px')
    })

    it('B2: wheel zooms in on scroll up and out on scroll down', async () => {
      await mountOverlay()
      wheel(-120)
      await nextTick()
      expect(scaleText()).toBe('125%')

      wheel(120)
      wheel(120)
      await nextTick()
      expect(scaleText()).toBe('80%')
    })

    it('B2b: trackpad pinch (many small deltas) zooms gradually', async () => {
      await mountOverlay()
      for (let i = 0; i < 20; i++) {
        wheel(-4)
      }
      await nextTick()
      expect(scaleText()).toBe('116%')
    })

    it('B3: scale stays within the zoom bounds', async () => {
      await mountOverlay()
      for (let i = 0; i < 20; i++) {
        click(toolbarBtn('Zoom in'))
      }
      await nextTick()
      expect(scaleText()).toBe('800%')

      for (let i = 0; i < 40; i++) {
        click(toolbarBtn('Zoom out'))
      }
      await nextTick()
      expect(scaleText()).toBe('10%')
    })

    it('B4: reset restores the fitted scale and clears the pan offset', async () => {
      await mountOverlay()
      click(toolbarBtn('Zoom in'))
      drag({ x: 10, y: 10 }, { x: 40, y: 30 })
      await nextTick()
      expect(canvasTransform()).toContain('translate(30px, 20px)')

      click(overlayEl()!.querySelector('.mermaid-overlay-reset')!)
      await nextTick()
      expect(scaleText()).toBe('100%')
      expect(canvasTransform()).toBe('translate(-50%, -50%) translate(0px, 0px)')
    })
  })

  describe('C. 拖动平移', () => {
    it('C1: dragging moves the canvas by the pointer delta', async () => {
      await mountOverlay()
      drag({ x: 100, y: 100 }, { x: 130, y: 80 })
      await nextTick()
      expect(canvasTransform()).toBe('translate(-50%, -50%) translate(30px, -20px)')
    })

    it('C2: moves after pointer up are ignored', async () => {
      await mountOverlay()
      drag({ x: 100, y: 100 }, { x: 120, y: 100 })
      canvasEl()!.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 300, pointerId: 1, bubbles: true }))
      await nextTick()
      expect(canvasTransform()).toBe('translate(-50%, -50%) translate(20px, 0px)')
    })

    it('C3: pointer move without a preceding pointer down is ignored', async () => {
      await mountOverlay()
      canvasEl()!.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 300, pointerId: 1, bubbles: true }))
      await nextTick()
      expect(canvasTransform()).toBe('translate(-50%, -50%) translate(0px, 0px)')
    })
  })

  describe('D. 关闭', () => {
    it('D1: clicking the scrim closes', async () => {
      const wrapper = await mountOverlay()
      click(overlayEl()!)
      await nextTick()
      expect(closes(wrapper)).toHaveLength(1)
    })

    it('D2: the close button closes', async () => {
      const wrapper = await mountOverlay()
      click(toolbarBtn('Close'))
      await nextTick()
      expect(closes(wrapper)).toHaveLength(1)
    })

    it('D3: clicking the diagram itself does not close', async () => {
      const wrapper = await mountOverlay()
      click(canvasEl()!)
      await nextTick()
      expect(closes(wrapper)).toHaveLength(0)
    })

    it('D4: Escape closes while mounted and stops listening after unmount', async () => {
      const onClose = vi.fn()
      const wrapper = await mountOverlay(svgMarkup, onClose)

      pressEscape()
      await nextTick()
      expect(onClose).toHaveBeenCalledTimes(1)

      wrapper.unmount()
      pressEscape()
      await nextTick()
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
