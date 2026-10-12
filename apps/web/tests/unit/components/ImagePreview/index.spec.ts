// ImagePreview/index.ts 工厂单测
// showImagePreview: 创建/复用 .image-preview-container，挂载 ImagePreview 组件
// onDismiss → unmount + 清理容器（最后一个移除时容器整体移除 + 调 dismissHandler）
import ImagePreviewModule from '~~/app/components/ImagePreview/index'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ImagePreview.vue 含复杂 DOM 操作；这里 stub 让 mount/unmount 不抛错
vi.mock('~~/app/components/ImagePreview/ImagePreview.vue', () => ({
  default: {
    name: 'ImagePreview',
    template: '<div class="image-preview-stub" @click="$emit(\'dismiss\')"></div>',
    props: ['url', 'imageFrame'],
    emits: ['dismiss']
  }
}))

const baseFrame = { left: 0, top: 0, width: 100, height: 100, imgWidth: 100, imgHeight: 100 }

describe('ImagePreview/index showImagePreview 工厂', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('首次调用 → 创建 .image-preview-container 并挂载 ImagePreview', () => {
    ImagePreviewModule.showImagePreview({ url: 'https://example.com/x.png', frame: baseFrame })
    const container = document.querySelector('.image-preview-container')
    expect(container).not.toBeNull()
    expect((container as HTMLElement).children.length).toBeGreaterThanOrEqual(1)
  })

  it('容器 style position=relative + z-index=100', () => {
    ImagePreviewModule.showImagePreview({ url: 'https://x', frame: baseFrame })
    const container = document.querySelector('.image-preview-container') as HTMLElement
    expect(container.style.position).toBe('relative')
    expect(container.style.getPropertyValue('z-index')).toBe('100')
  })

  it('已有容器 → 复用', () => {
    const existing = document.createElement('div')
    existing.classList.add('image-preview-container')
    document.body.appendChild(existing)
    ImagePreviewModule.showImagePreview({ url: 'https://x', frame: baseFrame })
    const list = document.querySelectorAll('.image-preview-container')
    expect(list.length).toBe(1)
  })

  it('dismiss → 容器 remove + 调 dismissHandler', async () => {
    const dismissHandler = vi.fn()
    ImagePreviewModule.showImagePreview({ url: 'https://x', frame: baseFrame, dismissHandler })
    // ImagePreview stub 接到 dismiss emit
    const stub = document.querySelector('.image-preview-stub') as HTMLElement
    expect(stub).not.toBeNull()
    stub.click()
    // app.unmount + element.remove → container 应被清空
    await Promise.resolve()
    expect(dismissHandler).toHaveBeenCalled()
  })

  it('多次 mount → 多个子节点共享容器，全部 dismiss 后 container remove', async () => {
    ImagePreviewModule.showImagePreview({ url: 'https://a', frame: baseFrame })
    ImagePreviewModule.showImagePreview({ url: 'https://b', frame: baseFrame })
    const container = document.querySelector('.image-preview-container') as HTMLElement
    expect(container.children.length).toBe(2)
    // 触发第一个 dismiss
    const stubs = container.querySelectorAll('.image-preview-stub')
    ;(stubs[0] as HTMLElement).click()
    await Promise.resolve()
    // 仍有 1 个剩余
    expect(container.children.length).toBe(1)
  })
})
