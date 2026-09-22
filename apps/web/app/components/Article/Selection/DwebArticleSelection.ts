import { getElementFullSelector } from '@commons/frontend-utils/dom'

import type { MarkModal } from './modal'
import { getUUID } from './tools'
import { ArticleSelection as BaseArticleSelection, type IMarkModal } from '@slax-reader/selection'
import type { IUserProvider, SelectionDependencies } from '@slax-reader/selection/adapters'
import type { MarkItemInfo, MarkPathItem, MarkSelectContent, MenuType, QuoteData, SelectionConfig, SelectTextInfo } from '@slax-reader/selection/types'

/**
 * Dweb端ArticleSelection扩展
 *
 * 继承自commons/selection的基础实现，添加dweb特定的业务逻辑
 */
export class DwebArticleSelection extends BaseArticleSelection {
  // 用 MarkModal 具体类型，showMenus 支持 hideComment 扩展项
  private modal: MarkModal
  private userProvider: IUserProvider

  // 上次弹菜单的目标（选区/图片）
  // 用于跳过滚动等重复 touchend
  private lastMenuRange: { sc: Node; so: number; ec: Node; eo: number } | null = null
  private lastMenuImage: HTMLElement | null = null

  constructor(config: SelectionConfig, dependencies: SelectionDependencies, modal: IMarkModal) {
    super(config, dependencies, modal)
    this.modal = modal as MarkModal
    this.userProvider = dependencies.userProvider
    // 点击已有划线时弹出选区菜单
    this.renderer.setMarkClickHandler(this.handleExistingMarkClick.bind(this))
  }

  /**
   * 点击已有划线：保留原侧栏逻辑，
   * 本人可操作的划线再加弹菜单
   */
  private handleExistingMarkClick(ele: HTMLElement, event: PointerEvent) {
    const markEl = (ele.closest?.('slax-mark') as HTMLElement | null) ?? ele
    const id = markEl?.dataset.uuid
    if (!id || id === '0') return

    const infoItem = this.markItemInfos.value.find(item => item.id === id)
    if (!infoItem) return

    // 原逻辑：打开评论侧栏
    this.manager.updateCurrentMarkItemInfo(infoItem)
    this.manager.showPanel()

    // 访客不可操作：不弹菜单
    if (!this.config.allowAction) return

    // 延后到 click 结束再弹，
    // 避开 click-outside 与重复 mouseup
    setTimeout(() => {
      const range = this.selectMarkContents(id)
      if (!range) return
      this.rememberMenuSelection(range)
      this.showExistingMarkMenus(event, infoItem)
    }, 0)
  }

  /** 选中该条划线全部分段，供菜单定位 */
  private selectMarkContents(id: string): Range | null {
    const root = this.config.monitorDom ?? this.document
    const marks = Array.from(root.querySelectorAll(`slax-mark[data-uuid="${id}"]`)) as HTMLElement[]
    const first = marks[0]
    const last = marks[marks.length - 1]
    if (!first || !last) return null

    const range = first.ownerDocument.createRange()
    range.setStartBefore(first)
    range.setEndAfter(last)

    const selection = this.getSelection()
    if (!selection) return null
    selection.removeAllRanges()
    selection.addRange(range)
    return range
  }

  // 选区仍有效且与上次弹菜单时不同才算误清空，否则 lastMenuRange 不重置会导致重选同一区域不再弹菜单
  private hasActiveSelection(): boolean {
    const sel = this.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || sel.toString().trim().length === 0) return false
    return !this.isSameSelectionAsLastMenu(sel.getRangeAt(0))
  }

  // 选区与上次一致即视为重复，跳过
  private isSameSelectionAsLastMenu(range: Range): boolean {
    const r = this.lastMenuRange
    return !!r && r.sc === range.startContainer && r.so === range.startOffset && r.ec === range.endContainer && r.eo === range.endOffset
  }

  private rememberMenuSelection(range: Range) {
    this.lastMenuImage = null
    this.lastMenuRange = { sc: range.startContainer, so: range.startOffset, ec: range.endContainer, eo: range.endOffset }
  }

  private rememberMenuImage(img: HTMLElement) {
    this.lastMenuRange = null
    this.lastMenuImage = img
  }

  // 清空时一并失忆，可再次弹出
  override clearSelection() {
    this.lastMenuRange = null
    this.lastMenuImage = null
    super.clearSelection()
  }

  /** 取消本人划线，留评论 */
  async deleteStroke(info: MarkItemInfo) {
    await this.manager.deleteStroke(info)
  }

  /**
   * 重写handleMouseUp以实现dweb特定的选择处理逻辑
   */
  protected override async handleMouseUp(e: MouseEvent | TouchEvent) {
    this.monitor.clearMouseListenerTry()

    setTimeout(() => {
      if (this.modal.isPanelExist(this.config.containerDom!)) {
        return
      }

      const target = e.target as HTMLElement | null
      if (target?.tagName === 'IMG' && this.isImageInContent(target as HTMLImageElement)) {
        const sel = this.getSelection()
        const hasTextSelection = !!sel && sel.rangeCount > 0 && !sel.isCollapsed && sel.toString().trim().length > 0
        if (!hasTextSelection) {
          this.handleImageSelection(e, target as HTMLImageElement)
          return
        }
      }

      const selection = this.getSelection()
      if (!selection || !selection.rangeCount) {
        this.manager.updateCurrentMarkItemInfo(null)
        return
      }

      const range = selection.getRangeAt(0)
      const { list, approx } = this.manager.getElementInfo(range)

      if (!list || list.length === 0 || !approx) {
        this.manager.updateCurrentMarkItemInfo(null)
        return
      }

      // 选区未变多为滚动，跳过重弹
      if (this.isSameSelectionAsLastMenu(range)) {
        return
      }

      const source = this.getMarkPathItems(list)
      if (!source) return

      const markInfoItem = this.markItemInfos.value.find(infoItem => this.manager.checkMarkSourceIsSame(infoItem.source, source))
      if (markInfoItem) {
        this.manager.updateCurrentMarkItemInfo(markInfoItem)
        // 精确选中一条已有划线：弹出选区菜单（划线项变「删除划线」），让用户能取消划线；
        // 纯评论、无划线的标记仍直接打开评论侧栏。
        this.rememberMenuSelection(range)
        if (markInfoItem.stroke.length > 0) {
          this.showExistingMarkMenus(e, markInfoItem)
        } else {
          this.manager.showPanel()
        }
        return
      }

      const currentMark = this.currentMarkItemInfo.value
      if (currentMark?.id === '' && this.manager.checkMarkSourceIsSame(currentMark.source, source)) return
      this.manager.updateCurrentMarkItemInfo({ id: '', source, comments: [], stroke: [], approx })
      this.manager.clearSelectContent()

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
      this.rememberMenuSelection(range)
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
            const isInline = !this.config.iframe
            if (isInline) {
              // inline 模式：补齐 quote 聚合，派发事件给 Vue 宿主消费
              const quote: QuoteData = {
                source: {},
                data: this.createQuote(currentInfo.source)
              }
              const sel = this.getSelection()
              const range = sel?.rangeCount ? sel.getRangeAt(0) : undefined
              const selected = this.manager.getElementsList(range!)
              if (!selected || selected.length === 0) {
                quote.source.selection = range
              } else {
                const paths = this.getMarkPathItems(selected)
                quote.source.paths = paths || (range ? undefined : [])
                if (!paths && range) quote.source.selection = range
              }
              window.dispatchEvent(
                new CustomEvent('slax:open-comment-panel', {
                  detail: { kind: 'new', info: { ...currentInfo }, quote }
                })
              )
            } else {
              // iframe 模式：保留原 CE Panel 渲染
              this.manager.showPanel({ fallbackYOffset: menusY })
            }
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
          // 选区仍有效说明是误判，不清空
          if (this.hasActiveSelection()) return
          this.clearSelection()
        }
      })
    }, 0)
  }

  private isImageInContent(img: HTMLElement): boolean {
    const root = !this.config.iframe ? (this.config.monitorDom?.querySelector('.html-text') as HTMLElement | null) : this.config.containerDom
    return !!root && root.contains(img)
  }

  private handleImageSelection(e: MouseEvent | TouchEvent, img: HTMLImageElement) {
    const source = this.getMarkPathItems([{ type: 'image', src: img.src, ele: img }])
    if (!source || source.length === 0) return

    // 同图重复触发，跳过
    if (this.lastMenuImage === img) return

    this.manager.updateCurrentMarkItemInfo({ id: '', source, comments: [], stroke: [], approx: undefined })
    this.manager.clearSelectContent()
    this.manager.pushSelectContent({ type: 'image', text: '', src: img.src })

    let menusY = 0
    this.rememberMenuImage(img)
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
          const isInline = !this.config.iframe
          if (isInline) {
            const quote: QuoteData = { source: { paths: source }, data: this.createQuote(source) }
            window.dispatchEvent(
              new CustomEvent('slax:open-comment-panel', {
                detail: { kind: 'new', info: { ...currentInfo }, quote }
              })
            )
          } else {
            this.manager.showPanel({ fallbackYOffset: menusY })
          }
        } else if (type === ('chatbot' as MenuType) && this.config.postQuoteDataHandler) {
          const quote: QuoteData = { source: { paths: source }, data: this.createQuote(source) }
          this.config.postQuoteDataHandler!(quote)
          this.findQuote(quote)
        }

        if (type !== ('comment' as MenuType)) this.clearSelection()
      },
      positionCallback: ({ y }) => (menusY = y),
      noActionCallback: () => {
        // 选区仍有效说明是误判，不清空
        if (this.hasActiveSelection()) return
        this.clearSelection()
      }
    })
  }

  /** 本人是否已对该划线发过根评论 */
  private hasOwnComment(info: MarkItemInfo): boolean {
    const userId = this.userProvider.getUserId()
    if (!userId) return false
    return info.comments.some(c => c.userId === userId && !c.isDeleted)
  }

  /**
   * 精确命中已有划线时的选区菜单：复制 / 删除划线 / 评论 / Chat。
   * 与新选区菜单（handleMouseUp 内联块）分开，避免误改已存在标记的 id 语义。
   */
  private showExistingMarkMenus(e: MouseEvent | TouchEvent, info: MarkItemInfo) {
    let menusY = 0
    this.modal.showMenus({
      event: e,
      // 有划线才显「删除划线」，否则显「划线」
      isStroked: info.stroke.length > 0,
      // 本人已评论过该划线则隐藏「评论」
      hideComment: this.hasOwnComment(info),
      callback: (type: MenuType, event: MouseEvent) => {
        if (type === ('stroke' as MenuType)) {
          this.manager.strokeSelection({ info })
        } else if (type === ('stroke_delete' as MenuType)) {
          this.manager.deleteStroke(info)
        } else if (type === ('copy' as MenuType)) {
          this.manager.copyMarkedText({ source: info.source, approx: info.approx, event })
        } else if (type === ('comment' as MenuType)) {
          // 已有标记追加评论：弹输入框
          const isInline = !this.config.iframe
          if (isInline) {
            window.dispatchEvent(
              new CustomEvent('slax:open-comment-panel', {
                detail: { kind: 'existing', infoId: info.id, info, compose: true }
              })
            )
          } else {
            this.manager.showPanel({ fallbackYOffset: menusY })
          }
          return
        } else if (type === ('chatbot' as MenuType) && this.config.postQuoteDataHandler) {
          const quote: QuoteData = { source: { id: info.id }, data: this.createQuote(info.source, info.approx) }
          this.config.postQuoteDataHandler(quote)
          this.findQuote(quote)
        }

        this.clearSelection()
      },
      positionCallback: ({ y }) => (menusY = y),
      noActionCallback: () => {
        // 选区仍有效说明是误判，不清空
        if (this.hasActiveSelection()) return
        this.clearSelection()
      }
    })
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
