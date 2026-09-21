/* 模仿vueuse实现的useDraggable,增加对iframe的兼容 */
import { ref, onMounted, onUnmounted, type Ref } from 'vue'
import { getElementOwnerWindow } from './dom'

export interface Position {
  x: number
  y: number
}

interface UseDraggableOptions {
  initialPosition?: Position
  bounds?: HTMLElement | null
  onDragStart?: (position: Position, event: MouseEvent | TouchEvent) => void
  onDragEnd?: (position: Position, event: MouseEvent | TouchEvent) => void
  onDrag?: (position: Position, event: MouseEvent | TouchEvent) => void
}

export const useDraggable = (target: Ref<HTMLElement | undefined>, options: UseDraggableOptions = {}) => {
  const { initialPosition = { x: 0, y: 0 }, bounds = null, onDragStart, onDragEnd, onDrag } = options
  const position = ref<Position>({ ...initialPosition })
  const isDragging = ref(false)

  let offset = { x: 0, y: 0 }

  function handleDragStart(event: MouseEvent | TouchEvent) {
    if (!target.value) return

    event.preventDefault()

    isDragging.value = true

    const clientX = 'touches' in event ? (event.touches[0]?.clientX ?? 0) : event.clientX
    const clientY = 'touches' in event ? (event.touches[0]?.clientY ?? 0) : event.clientY

    offset = {
      x: clientX - position.value.x,
      y: clientY - position.value.y
    }

    onDragStart?.(position.value, event)

    const contentWindow = getElementOwnerWindow(target.value)
    contentWindow.addEventListener('mousemove', handleDragMove)
    contentWindow.addEventListener('touchmove', handleDragMove)
    contentWindow.addEventListener('mouseup', handleDragEnd)
    contentWindow.addEventListener('touchend', handleDragEnd)
  }

  const handleDragMove = (event: MouseEvent | TouchEvent) => {
    if (!isDragging.value || !target.value) return

    const clientX = 'touches' in event ? (event.touches[0]?.clientX ?? 0) : event.clientX
    const clientY = 'touches' in event ? (event.touches[0]?.clientY ?? 0) : event.clientY

    let newX = clientX - offset.x
    let newY = clientY - offset.y

    if (bounds) {
      const targetRect = target.value.getBoundingClientRect()
      const boundsRect = bounds.getBoundingClientRect()

      newX = Math.max(boundsRect.left, Math.min(newX, boundsRect.right - targetRect.width))
      newY = Math.max(boundsRect.top, Math.min(newY, boundsRect.bottom - targetRect.height))
    }

    position.value = { x: newX, y: newY }

    applyPosition()

    onDrag?.(position.value, event)
  }

  const handleDragEnd = (event: MouseEvent | TouchEvent) => {
    if (!isDragging.value) return

    isDragging.value = false

    onDragEnd?.(position.value, event)

    const contentWindow = getElementOwnerWindow(target.value!)

    contentWindow.removeEventListener('mousemove', handleDragMove)
    contentWindow.removeEventListener('touchmove', handleDragMove)
    contentWindow.removeEventListener('mouseup', handleDragEnd)
    contentWindow.removeEventListener('touchend', handleDragEnd)
  }

  const applyPosition = () => {
    if (!target.value) return
  }

  const reset = () => {
    position.value = { ...initialPosition }
    applyPosition()
  }

  onMounted(() => {
    if (!target.value) return

    applyPosition()
    target.value.addEventListener('mousedown', handleDragStart)
    target.value.addEventListener('touchstart', handleDragStart)
  })

  onUnmounted(() => {
    if (!target.value) return
    const contentWindow = getElementOwnerWindow(target.value!)

    target.value.removeEventListener('mousedown', handleDragStart)
    target.value.removeEventListener('touchstart', handleDragStart)
    contentWindow.removeEventListener('mousemove', handleDragMove)
    contentWindow.removeEventListener('touchmove', handleDragMove)
    contentWindow.removeEventListener('mouseup', handleDragEnd)
    contentWindow.removeEventListener('touchend', handleDragEnd)
  })

  return {
    position,
    isDragging,
    reset
  }
}
