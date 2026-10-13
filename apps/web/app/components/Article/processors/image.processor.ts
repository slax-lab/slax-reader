import type { DOMProcessor, WebProcessorContext } from './types'
import { ArticleStyle } from './types'

function unwrapImgAnchorsInTweet(container: HTMLElement) {
  const firstDiv = container.querySelector(':scope > .html-text > div')
  // tweet 与 social-post 卡片
  // 都需解包 <a><img>
  if (!firstDiv?.classList.contains('tweet') && !firstDiv?.classList.contains('social-post')) return

  container.querySelectorAll('a img').forEach(img => {
    const anchor = img.closest('a')
    if (!anchor) return
    const parent = anchor.parentNode
    if (!parent) return
    while (anchor.firstChild) {
      parent.insertBefore(anchor.firstChild, anchor)
    }
    parent.removeChild(anchor)
  })
}

// 微信公众号文章的图片 style 已由后端保留（含 !important 声明），前端不应再整体覆盖
const STYLE_PRESERVED_HOSTS = ['mp.weixin.qq.com']

function hasStyleDeclaration(style: string, prop: string): boolean {
  return new RegExp(`(^|;)\\s*${prop}\\s*:`, 'i').test(style)
}

// 在已有 style 基础上补齐缺失的 padding/height，而不是整体覆盖
function ensurePaddingAndHeightStyle(img: HTMLImageElement): void {
  const currentStyle = img.getAttribute('style') || ''
  const missing = [!hasStyleDeclaration(currentStyle, 'padding') && 'padding: 0 !important', !hasStyleDeclaration(currentStyle, 'height') && 'height: auto !important'].filter(
    (declaration): declaration is string => !!declaration
  )

  if (!missing.length) return

  const trimmedStyle = currentStyle.trim()
  const separator = trimmedStyle ? (trimmedStyle.endsWith(';') ? ' ' : '; ') : ''
  img.setAttribute('style', `${trimmedStyle}${separator}${missing.join('; ')};`)
}

export class ImageProcessor implements DOMProcessor {
  readonly name = 'ImageProcessor'

  match(): boolean {
    return true
  }

  process(context: WebProcessorContext): void {
    unwrapImgAnchorsInTweet(context.container)

    const preserveStyle = STYLE_PRESERVED_HOSTS.includes(context.url.host)
    const loadingKey = 'slax-image-loading'
    const imgs = Array.from(context.container.querySelectorAll('img')) as HTMLImageElement[]

    imgs.forEach(img => {
      const url = img.currentSrc || img.src || ''
      if (!url) {
        img.style.display = 'none'
        return
      }

      img.srcset = ''
      img.onload = () => {
        img.classList.remove(loadingKey)

        if (context.articleStyle === ArticleStyle.PhotoSwipeTopic) {
        } else {
          if (img.naturalWidth < 5 || img.naturalHeight < 5) {
            img.setAttribute('style', 'display: none;')
            return
          } else if (img.naturalWidth < 200) {
            img.setAttribute('style', `width: ${img.naturalWidth}px !important;`)
            return
          }

          if (!preserveStyle) {
            img.removeAttribute('style')
          }
          ensurePaddingAndHeightStyle(img)
        }

        img.onclick = () => {
          const rect = img.getBoundingClientRect()
          const frame = {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            imgWidth: img.naturalWidth,
            imgHeight: img.naturalHeight
          }

          context.callbacks.screenLockUpdate(true)
          context.callbacks.showImagePreview({
            url: img.currentSrc || img.src,
            frame,
            dismissHandler: () => {
              context.callbacks.screenLockUpdate(false)
            }
          })

          return false
        }
      }

      img.referrerPolicy = ''

      img.onerror = () => {
        img.classList.remove(loadingKey)
        img.style.display = 'none'
      }

      img.classList.add(loadingKey)

      const parentElement = img.parentElement
      const parentChilds = parentElement ? Array.from(parentElement.childNodes) : []

      const isOnlyImages = parentChilds.every(child => {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const element = child as HTMLElement
          return element.tagName.toLowerCase() === 'img'
        }
        return true
      })

      if (isOnlyImages) {
        img.style.cssFloat = 'none'
      }
    })

    if (preserveStyle && context.articleStyle !== ArticleStyle.PhotoSwipeTopic) {
      // Backend pixel dimensions may be intrinsic; shrink oversized images while preserving icons.
      const fixedSizeImgs = imgs.filter(img => /^[\d.]+px$/.test(img.style.width) && /^[\d.]+px$/.test(img.style.height))
      if (!fixedSizeImgs.length) return

      const fitOversizedImages = () => {
        const availableWidth = context.container.clientWidth
        if (availableWidth <= 0) return

        for (const img of fixedSizeImgs) {
          if (!img.style.width.endsWith('px') || parseFloat(img.style.width) <= availableWidth) continue
          img.style.setProperty('width', '100%', 'important')
          img.style.setProperty('height', 'auto', 'important')
        }
      }

      // Do not depend on load events: lazy and cached images also need fixed placeholder heights removed.
      fitOversizedImages()
      const view = context.container.ownerDocument.defaultView
      if (view?.ResizeObserver) {
        let frame: number | undefined
        const observer = new view.ResizeObserver(() => {
          if (frame !== undefined) return
          // Height changes resize the observed container; defer writes to avoid a notification loop.
          frame = view.requestAnimationFrame(() => {
            frame = undefined
            fitOversizedImages()
          })
        })
        observer.observe(context.container)
        context.cleanups.push(() => {
          observer.disconnect()
          if (frame !== undefined) view.cancelAnimationFrame(frame)
        })
      }
    }
  }
}
