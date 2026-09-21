import { createApp, h } from 'vue'

import ImagePreview, { type ImagePreviewFrame } from './ImagePreview.vue'

const showImagePreview = (options: { url: string; frame: ImagePreviewFrame; dismissHandler?: () => void }) => {
  let previewElement = document.querySelector('.image-preview-container') as HTMLElement
  if (!previewElement) {
    previewElement = document.createElement('div')
    previewElement.classList.add('image-preview-container')
    previewElement.style.setProperty('z-index', `${100}`)
    previewElement.style.position = 'relative'
    document.body.appendChild(previewElement)
  }

  const element = document.createElement('div')
  previewElement.appendChild(element)

  const app = createApp({
    render() {
      return h(ImagePreview, {
        url: options.url,
        imageFrame: options.frame,
        onDismiss: () => {
          app.unmount()
          element.remove()
          if (Array(...previewElement.children).length === 0) {
            previewElement.remove()
          }

          options.dismissHandler && options.dismissHandler()
        }
      })
    }
  })

  app.mount(element)
}

export default {
  showImagePreview
}
