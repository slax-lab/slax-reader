import { createApp } from 'vue'

import ArticleSelectionMenus from './ArticleSelectionMenus.vue'
import ArticleSelectionPanel from './ArticleSelectionPanel.vue'

import { ExtensionsEnvironmentAdapter } from './adapters'
import { Base, type IMarkModal } from '@slax-reader/selection'
import type { IUserProvider } from '@slax-reader/selection/adapters'
import type { MarkItemInfo, MenuType, SelectionConfig } from '@slax-reader/selection/types'

const menusKey = `slax-reader-article-selection-menus-container`
const panelKey = `slax-reader-article-selection-panel-container`

const isNullRect = (rect: DOMRect) => {
  return !rect || (rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.left === 0)
}

export class MarkModal extends Base implements IMarkModal {
  currentPanel: InstanceType<typeof ArticleSelectionPanel> | null = null
  private userProvider: IUserProvider

  constructor(config: SelectionConfig, userProvider: IUserProvider) {
    const environmentAdapter = new ExtensionsEnvironmentAdapter()
    super(config, environmentAdapter)
    this.userProvider = userProvider
  }

  isPanelExist(container?: HTMLDivElement) {
    const articleSelectionPanel = (container || this.document).querySelector(`.${panelKey}`) as HTMLElement
    return !!articleSelectionPanel
  }

  async dismissPanel() {
    if (this.currentPanel) {
      this.currentPanel.closeModal()
    }
  }

  showMenus(options: {
    event: MouseEvent | TouchEvent
    isStroked?: boolean
    callback?: (type: MenuType, event: MouseEvent) => void
    positionCallback?: (position: { x: number; y: number }) => void
    noActionCallback?: () => void
  }) {
    const { event, isStroked, callback, positionCallback, noActionCallback } = options
    const { containerDom, allowAction } = this.config

    if (!containerDom || this.isPanelExist(containerDom)) {
      return
    }

    let articleSelectionMenus = containerDom.querySelector(`.${menusKey}`) as HTMLElement
    if (articleSelectionMenus) {
      articleSelectionMenus.remove()
    }

    articleSelectionMenus = this.document.createElement('div')
    articleSelectionMenus.classList.add(menusKey)
    articleSelectionMenus.style.setProperty('z-index', `${999}`)
    articleSelectionMenus.style.setProperty('position', `absolute`)

    containerDom.appendChild(articleSelectionMenus)

    const app = createApp(ArticleSelectionMenus, {
      allowAction,
      isStroked,
      onDismiss: () => {
        app.unmount()
        articleSelectionMenus.remove()
      },
      onAction: (type: MenuType, event: MouseEvent) => {
        callback && callback(type, event)
      },
      onNoAction: () => {
        noActionCallback && noActionCallback()
      }
    })

    app.mount(articleSelectionMenus)

    const selection = this.window.getSelection()
    if (!selection || !selection.rangeCount) return
    const range = selection.getRangeAt(0)
    if (!range) {
      return
    }

    if (!(event instanceof PointerEvent) && range.startOffset === range.endOffset && range.startContainer === range.endContainer) {
      // marks: slax-mark点击归属于ponter event
      return
    }

    const rangeRect = range.getBoundingClientRect()

    const minY = rangeRect.top
    const maxY = rangeRect.top + rangeRect.height
    let offsetX = event instanceof MouseEvent ? event.clientX : event.changedTouches[0].clientX
    let offsetY = event instanceof MouseEvent ? event.clientY : event.changedTouches[0].clientY

    const isBottomCloser = Math.abs(maxY - offsetY) < Math.abs(minY - offsetY)

    const bodyRect = this.document.body.getBoundingClientRect()
    if (bodyRect) {
      offsetY -= bodyRect.top
    }

    nextTick(() => {
      const scrollOffsetY = this.window.scrollY
      const windowHeight = this.window.innerHeight
      const menuRect = articleSelectionMenus.getBoundingClientRect()
      if (menuRect) {
        const gap = 10
        offsetX -= (menuRect.width * 1) / 4

        let targetOffsetY = offsetY
        if (isBottomCloser) {
          targetOffsetY = maxY + gap
        } else {
          targetOffsetY = minY - (menuRect.height + gap)
        }

        const resY = scrollOffsetY + targetOffsetY

        // 在视窗内才执行位置更新
        if (scrollOffsetY + windowHeight > resY && scrollOffsetY < resY) {
          offsetY = scrollOffsetY + targetOffsetY
        }
      }

      if (offsetX + menuRect.width > bodyRect.width) {
        offsetX = bodyRect.width - menuRect.width
      }

      articleSelectionMenus.style.setProperty('left', `${offsetX}px`)
      articleSelectionMenus.style.setProperty('top', `${offsetY}px`)

      positionCallback && positionCallback({ x: offsetX, y: offsetY })
    })
  }

  showPanel(options: {
    info: MarkItemInfo
    fallbackYOffset: number
    actionCallback?: (type: MenuType, meta: { comment: string; info: MarkItemInfo; replyToUid?: string; event?: MouseEvent }) => void
    commentDeleteCallback?: (id: string, markUid: string) => void
    dismissCallback?: () => void
  }) {
    const { info, actionCallback, commentDeleteCallback, dismissCallback } = options
    const { containerDom, allowAction } = this.config
    const userInfo = this.userProvider.getUserInfo()
    if (!containerDom || !userInfo) {
      return
    }

    const userId = userInfo.userId

    let articleSelectionPanel = containerDom.querySelector(`.${panelKey}`) as HTMLElement
    if (articleSelectionPanel) {
      articleSelectionPanel.remove()
    }

    articleSelectionPanel = this.document.createElement('div')
    articleSelectionPanel.classList.add(panelKey)
    articleSelectionPanel.style.setProperty('z-index', `${999}`)
    articleSelectionPanel.style.setProperty('position', `fixed`)

    containerDom.appendChild(articleSelectionPanel)

    let panel: InstanceType<typeof ArticleSelectionPanel> | null = null

    const getIdealOffset = (position: { x: number; y: number }) => {
      const panelRect = articleSelectionPanel.getBoundingClientRect()

      let { x, y } = position
      const panelWidth = panelRect.width || 400
      const panelHeight = panelRect.height || 300
      const screenWidth = this.window.innerWidth
      const screenHeight = this.window.innerHeight
      if (x + panelWidth > screenWidth) {
        x = screenWidth - panelWidth
      }

      if (y + panelHeight > screenHeight) {
        y = screenHeight - panelHeight
      }

      return { x, y }
    }
    // 因为有不止一处用到这块逻辑因此抽离出来
    const updatePanelOffset = () => {
      const panelRect = articleSelectionPanel.getBoundingClientRect()
      const position = getIdealOffset({ x: panelRect.left, y: panelRect.y })

      panel?.updateLocation(position)
      panel?.maxHeightUpdate(Math.min(containerDom.getBoundingClientRect().height, this.window.innerHeight * 0.8))
    }

    const app = createApp(ArticleSelectionPanel, {
      info,
      userId,
      allowAction,
      onDismiss: () => {
        app.unmount()
        articleSelectionPanel.remove()
        dismissCallback && dismissCallback()
        this.currentPanel = null
      },
      onAction: (type: MenuType, meta: { comment: string; info: MarkItemInfo; event: MouseEvent }) => {
        actionCallback && actionCallback(type, meta)
      },
      onCommentDelete: (params: { id: string; markUid: string }) => {
        commentDeleteCallback && commentDeleteCallback(params.id, params.markUid)
      },
      onLocationUpdate: (params: { x: number; y: number }) => {
        const { x, y } = params
        articleSelectionPanel.style.setProperty('top', `${y}px`)
        articleSelectionPanel.style.setProperty('left', `${x}px`)
      },
      onWindowResize: () => {
        updatePanelOffset()
      }
    })

    panel = app.mount(articleSelectionPanel) as InstanceType<typeof ArticleSelectionPanel>
    this.currentPanel = panel
    const selection = this.window.getSelection()

    let topOffset = 0
    let leftOffset = 0
    if (!selection || !selection.rangeCount) {
      topOffset = options.fallbackYOffset
    } else {
      const range = selection.getRangeAt(0)
      const rect = range?.getBoundingClientRect()
      const isZeroRect = isNullRect(rect)
      if (isZeroRect && range.startContainer instanceof HTMLElement) {
        topOffset = range.startContainer.getBoundingClientRect().top - 10
      } else if (!isZeroRect) {
        topOffset = rect.top + 50
      }

      if (isZeroRect && range.startContainer instanceof HTMLElement) {
        leftOffset = range.startContainer.getBoundingClientRect().left + 10
      } else if (!isZeroRect) {
        leftOffset = rect.left - 50
      }
    }

    nextTick(() => {
      const panelRect = articleSelectionPanel.getBoundingClientRect()
      leftOffset = Math.max(0, leftOffset - (panelRect.width * 1) / 4)

      const position = getIdealOffset({ x: leftOffset, y: topOffset })

      panel.updateLocation(position)
      panel.positionConfirmedHandler()
    })
  }
}
