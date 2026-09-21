import { PhotoSwiperDotsElement } from '../CEComponents'
import type { DOMProcessor, WebProcessorContext } from './types'
import { ArticleStyle } from './types'
import { useDebounceFn } from '@vueuse/core'

export class PhotoSwipeProcessor implements DOMProcessor {
  readonly name = 'PhotoSwipeProcessor'

  match(context: WebProcessorContext): boolean {
    return context.articleStyle === ArticleStyle.PhotoSwipeTopic
  }

  process(context: WebProcessorContext): void {
    const swiper = context.container.querySelector('slax-photo-swipe-topic > .topic-container .swiper')
    if (!swiper) return

    const count = swiper.childElementCount
    const dotsEle = new PhotoSwiperDotsElement({
      count,
      selectIndex: 0
    })

    const indexSelectedHandler = (event: Event) => {
      const customEvent = event as CustomEvent<number[]>
      const args = customEvent.detail
      if (!args || args.length === 0 || args[0] === undefined) return

      dotsEle.selectIndex = args[0]
      swiper.scrollTo({
        left: args[0] * swiper.clientWidth,
        behavior: 'smooth'
      })
    }

    dotsEle.addEventListener('indexSelected', indexSelectedHandler)
    swiper.parentElement?.appendChild(dotsEle)

    const debouncedScrollFn = useDebounceFn(
      () => {
        const index = Math.round(swiper.scrollLeft / swiper.clientWidth)
        dotsEle.selectIndex = index
      },
      50,
      { maxWait: 5000 }
    )

    swiper.addEventListener('scroll', debouncedScrollFn)

    // 鼠标无横滑手势，
    // 补按住拖动横向滚动
    const swiperEl = swiper as HTMLElement
    const DRAG_THRESHOLD = 5 // 超过此位移才算拖动
    let pointerDown = false
    let isDragging = false
    let suppressClick = false
    let startX = 0
    let startScrollLeft = 0

    const onPointerDown = (event: Event) => {
      const e = event as PointerEvent
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      // 先只记录起点，移动超阈值再算拖动，
      // 否则会吞掉图片点击（看大图）
      pointerDown = true
      isDragging = false
      suppressClick = false
      startX = e.clientX
      startScrollLeft = swiperEl.scrollLeft
    }

    const onPointerMove = (event: Event) => {
      if (!pointerDown) return
      const e = event as PointerEvent
      const dx = e.clientX - startX
      if (!isDragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD) return
        isDragging = true
        swiperEl.style.cursor = 'grabbing'
        swiperEl.style.scrollSnapType = 'none' // 拖动时关闭吸附
        swiperEl.setPointerCapture(e.pointerId)
      }
      swiperEl.scrollLeft = startScrollLeft - dx
    }

    const endDrag = (event: Event) => {
      if (!pointerDown) return
      pointerDown = false
      const e = event as PointerEvent
      if (isDragging) {
        isDragging = false
        suppressClick = true // 拖动后抑制随之而来的 click
        swiperEl.style.cursor = ''
        swiperEl.style.scrollSnapType = '' // 松手吸附到最近一张
        if (swiperEl.hasPointerCapture?.(e.pointerId)) swiperEl.releasePointerCapture(e.pointerId)
      }
    }

    // 真拖动后抑制这次 click，
    // 避免松手误开大图
    const onClickCapture = (event: Event) => {
      if (!suppressClick) return
      suppressClick = false
      event.preventDefault()
      event.stopPropagation()
    }

    // 阻止图片原生拖拽
    const onDragStart = (event: Event) => event.preventDefault()

    swiperEl.addEventListener('pointerdown', onPointerDown)
    swiperEl.addEventListener('pointermove', onPointerMove)
    swiperEl.addEventListener('pointerup', endDrag)
    swiperEl.addEventListener('pointercancel', endDrag)
    swiperEl.addEventListener('click', onClickCapture, true)
    swiperEl.addEventListener('dragstart', onDragStart)

    context.cleanups.push(() => {
      dotsEle.removeEventListener('indexSelected', indexSelectedHandler)
      swiper.removeEventListener('scroll', debouncedScrollFn)
      swiperEl.removeEventListener('pointerdown', onPointerDown)
      swiperEl.removeEventListener('pointermove', onPointerMove)
      swiperEl.removeEventListener('pointerup', endDrag)
      swiperEl.removeEventListener('pointercancel', endDrag)
      swiperEl.removeEventListener('click', onClickCapture, true)
      swiperEl.removeEventListener('dragstart', onDragStart)
    })
  }
}
