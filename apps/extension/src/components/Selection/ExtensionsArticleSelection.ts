import { getElementFullSelector } from '@commons/utils/dom'

import { getUUID } from './tools'
import { ArticleSelection as BaseArticleSelection, type IMarkModal } from '@slax-reader/selection'
import type { SelectionDependencies } from '@slax-reader/selection/adapters'
import type { MarkPathItem, MarkSelectContent, MenuType, QuoteData, SelectionConfig, SelectTextInfo } from '@slax-reader/selection/types'

/**
 * Extensions端ArticleSelection扩展
 *
 * 继承自commons/selection的基础实现，添加extensions特定的业务逻辑
 */
export class ExtensionsArticleSelection extends BaseArticleSelection {
  private modal: IMarkModal

  constructor(config: SelectionConfig, dependencies: SelectionDependencies, modal: IMarkModal) {
    super(config, dependencies, modal)
    this.modal = modal
  }

  /**
   * 重写handleMouseUp以实现extensions特定的选择处理逻辑
   */
  protected override async handleMouseUp(e: MouseEvent | TouchEvent) {
    this.monitor.clearMouseListenerTry()

    setTimeout(() => {
      if (this.modal.isPanelExist(this.config.containerDom!)) {
        return
      }

      const selection = this.getSelection()
      if (!selection || !selection.rangeCount) {
        this.manager.updateCurrentMarkItemInfo(null)
        return
      }

      const range = selection.getRangeAt(0)
      const { list, approx } = this.manager.getElementInfo(range)

      if (!list || list.length === 0 || !approx) {
        if (e.target instanceof HTMLElement && e.target?.nodeName !== 'SLAX-MARK') {
          this.manager.updateCurrentMarkItemInfo(null)
        }
        return
      }

      const source = this.getMarkPathItems(list)
      if (!source) return

      const markInfoItem = this.markItemInfos.value.find(infoItem => this.manager.checkMarkSourceIsSame(infoItem.source, source))
      const currentMark = this.currentMarkItemInfo.value
      if (markInfoItem) {
        this.manager.updateCurrentMarkItemInfo(markInfoItem)
        if (currentMark?.comments && currentMark?.comments.length > 0) {
          this.config.markCommentSelectHandler?.(currentMark?.comments[0])
          return
        }
      } else {
        if (currentMark?.id === '' && this.manager.checkMarkSourceIsSame(currentMark.source, source)) return
        this.manager.updateCurrentMarkItemInfo({ id: '', source, comments: [], stroke: [], approx })
        this.manager.clearSelectContent()
      }

      list.forEach((item: SelectTextInfo) => {
        const lastContent = this.selectContent.value[this.selectContent.value.length - 1]
        const newContent: MarkSelectContent = {
          type: item.type,
          text: item.type === 'text' ? item.text : '',
          src: item.type === 'image' ? item.src : ''
        }
        newContent.text = newContent.text.replace(/\n/g, '')
        if (lastContent?.type === 'text' && item.type === 'text') {
          lastContent.text += item.text
        } else {
          this.manager.pushSelectContent(newContent)
        }
      })

      let menusY = 0
      this.modal.showMenus({
        event: e,
        callback: (type: MenuType, event: MouseEvent) => {
          const currentInfo = this.currentMarkItemInfo.value
          if (!currentInfo) return

          if (type === ('stroke' as MenuType)) {
            currentInfo.id = getUUID()
            this.manager.strokeSelection({ info: currentInfo })
          } else if (type === ('copy' as MenuType)) {
            this.manager.copyMarkedText({ source, event })
          } else if (type === ('comment' as MenuType)) {
            currentInfo.id = getUUID()
            this.config.menusCommentHandler?.(currentInfo, this.createQuote(currentInfo.source, currentInfo.approx))
          } else if (type === ('chatbot' as MenuType) && this.config.postQuoteDataHandler) {
            const quote: QuoteData = {
              source: {},
              data: this.createQuote(currentInfo.source)
            }
            const selection = this.getSelection()
            const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined
            const selected = this.manager.getElementsList(range!)

            if (!selected || selected.length === 0) {
              quote.source.selection = range
            } else {
              const paths = this.getMarkPathItems(selected)
              quote.source.paths = paths || (range ? undefined : [])
              if (!paths && range) quote.source.selection = range
            }

            this.config.postQuoteDataHandler!(quote)
            this.findQuote(quote)
          }

          if (type !== ('comment' as MenuType)) this.clearSelection()
        },
        positionCallback: ({ y }) => (menusY = y),
        noActionCallback: () => {
          this.manager.updateCurrentMarkItemInfo(null)
          this.manager.clearSelectContent()
        }
      })
    }, 0)
  }

  /**
   * 从选择信息生成标记路径项
   */
  private getMarkPathItems(infos: SelectTextInfo[]): MarkPathItem[] | null {
    const markItems: MarkPathItem[] = []
    const ele = !this.config.iframe ? this.config.monitorDom?.querySelector('.html-text') : null

    for (const info of infos) {
      if (info.type === 'text') {
        const selector = getElementFullSelector(info.node!.parentElement!, ['slax-mark'], ele!)
        const baseElement = this.config.monitorDom?.querySelector(selector) as HTMLElement
        if (!baseElement) return null

        const nodes = this.renderer.getAllTextNodes(baseElement)
        const nodeLengths = nodes.map((node: Node) => (node.textContent || '').length)
        const nodeIndex = nodes.indexOf(info.node as Node)
        if (nodeIndex === -1) continue

        const base = nodeLengths.slice(0, nodeIndex).reduce((acc: number, cur: number) => acc + cur, 0)
        markItems.push({ type: 'text', path: selector, start: base + info.startOffset, end: base + info.endOffset })
      } else if (info.type === 'image') {
        const selector = getElementFullSelector(info.ele as HTMLElement, ['slax-mark'], ele!)
        const baseElement = this.config.monitorDom?.querySelector(selector) as HTMLElement
        if (!baseElement) return null
        markItems.push({ type: 'image', path: selector })
      }
    }
    return markItems
  }
}
