import { removeOuterTag } from '@commons/utils/dom'
import type { MarkDetail, MarkPathItem, MarkSelectContent, MarkPathApprox } from '@commons/types/interface'

import { Base } from './Base'
import { MarkManager, type IMarkModal, type Ref } from './MarkManager'
import { MarkRenderer } from './MarkRenderer'
import { SelectionMonitor } from './SelectionMonitor'
import type { SelectionConfig, StrokeSelectionMeta, QuoteData, MarkItemInfo } from '../types'
import type { SelectionDependencies } from '../adapters'

// 重新导出IMarkModal供外部使用
export type { IMarkModal } from './MarkManager'

/**
 * ArticleSelection主入口
 *
 * 统一了dweb和extensions的Selection功能，协调各个子模块的工作
 */
export class ArticleSelection extends Base {
  protected monitor: SelectionMonitor
  protected manager: MarkManager
  protected renderer: MarkRenderer

  constructor(config: SelectionConfig, dependencies: SelectionDependencies, modal: IMarkModal) {
    super(config, dependencies.environmentAdapter)

    this.renderer = new MarkRenderer(config, dependencies.environmentAdapter, dependencies.userProvider)
    this.manager = new MarkManager(
      config,
      dependencies.environmentAdapter,
      {
        userProvider: dependencies.userProvider,
        httpClient: dependencies.httpClient,
        toastService: dependencies.toastService,
        i18nService: dependencies.i18nService,
        bookmarkProvider: dependencies.bookmarkProvider,
        refFactory: dependencies.refFactory,
        getMarkType: dependencies.getMarkType
      },
      this.renderer,
      modal,
      this.findQuote.bind(this)
    )
    this.monitor = new SelectionMonitor(config, dependencies.environmentAdapter, this.handleMouseUp.bind(this))
  }

  /**
   * 开始监听用户选择
   */
  startMonitor() {
    this.monitor.start()
  }

  /**
   * 停止监听用户选择
   */
  closeMonitor() {
    this.monitor.stop()
  }

  /**
   * 绘制标记列表
   * @param marks 标记详情
   */
  async drawMark(marks: MarkDetail) {
    await this.manager.drawMarks(marks)
  }

  /**
   * 划线选择
   * @param info 划线元数据
   */
  async strokeSelection(info: StrokeSelectionMeta) {
    return await this.manager.strokeSelection(info)
  }

  /**
   * 删除评论
   * @param id 标记ID
   * @param markUid 评论UUID
   */
  async deleteComment(id: string, markUid: string) {
    await this.manager.deleteComment(id, markUid)
  }

  /**
   * 创建引用数据
   * @param items 标记路径项
   * @param approx 近似匹配信息
   * @returns 引用数据
   */
  createQuote(items: MarkPathItem[], approx?: MarkPathApprox): QuoteData['data'] {
    return this.manager.createQuote(items, approx)
  }

  /**
   * 查找并高亮引用内容
   * @param quote 引用数据
   */
  findQuote(quote: QuoteData) {
    // 清除所有高亮
    const allMarks = Array.from(this.document.querySelectorAll(`slax-mark`))
    allMarks.forEach(mark => mark.classList.remove('slax-mk-highlighted'))

    if (quote.source.selection) {
      // 使用原生Selection API高亮
      const selection = this.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(quote.source.selection)
      quote.source.selection.startContainer.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
    } else if (quote.source.paths) {
      // 根据路径绘制临时高亮标记
      Array.from(this.document.querySelectorAll(`slax-mark[data-uuid="0"]`) || []).forEach(removeOuterTag)
      const baseInfo = { id: '0', isStroke: false, isComment: false, isSelfStroke: false, isHighlighted: true }

      for (const markItem of quote.source.paths) {
        const infos = this.renderer.transferNodeInfos(markItem)
        for (const info of infos) {
          if (info.type === 'image') {
            this.renderer.addImageMark({ ...baseInfo, ele: info.ele as HTMLImageElement })
          } else {
            this.renderer.addMark({ ...baseInfo, node: info.node, start: info.start, end: info.end })
          }
        }
      }

      const slaxMarks = Array.from(this.document.querySelectorAll(`slax-mark[data-uuid="0"]`))
      if (slaxMarks.length === 0) return

      slaxMarks[0].scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })

      // 点击任意位置清除临时高亮
      const clickHandler = () => {
        slaxMarks.forEach(removeOuterTag)
        ;['mousedown', 'touchstart'].forEach(event => this.config.monitorDom?.removeEventListener(event, clickHandler))
      }
      ;['mousedown', 'touchstart'].forEach(event => this.config.monitorDom?.addEventListener(event, clickHandler))
    } else if (quote.source.id) {
      // 根据ID高亮已存在的标记
      const slaxMarks = Array.from(this.document.querySelectorAll(`slax-mark[data-uuid="${quote.source.id}"]`))
      if (slaxMarks.length === 0) return

      slaxMarks.forEach(mark => mark.classList.add('slax-mk-highlighted'))
      slaxMarks[0].scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })

      // 点击任意位置清除高亮
      const clickHandler = () => {
        slaxMarks.forEach(mark => mark.classList.remove('slax-mk-highlighted'))
        this.config.monitorDom?.removeEventListener('click', clickHandler)
      }
      this.config.monitorDom?.addEventListener('click', clickHandler)
    }
  }

  /**
   * 处理鼠标抬起事件
   * @param e 鼠标或触摸事件
   */
  protected async handleMouseUp(e: MouseEvent | TouchEvent) {
    this.monitor.clearMouseListenerTry()

    setTimeout(() => {
      // 暂时简化实现，移除与modal的交互逻辑
      // 实际使用时需要在各端自己实现完整的handleMouseUp逻辑
      const selection = this.getSelection()
      if (!selection || !selection.rangeCount) {
        if (e.target instanceof HTMLElement && e.target?.nodeName !== 'SLAX-MARK') {
          this.manager.updateCurrentMarkItemInfo(null)
        }
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

      // TODO: 完整的选择处理逻辑需要在各端实现
      // 这里只保留基础的标记信息更新
    }, 0)
  }

  /**
   * 清除选择
   */
  clearSelection() {
    const selection = this.getSelection()
    if (selection) selection.removeAllRanges()
    this.manager.updateCurrentMarkItemInfo(null)
    this.manager.clearSelectContent()
  }

  /**
   * 获取Selection对象
   * 子类可以重写此方法以适配不同环境
   */
  protected getSelection(): Selection | null {
    return this.window.getSelection()
  }

  /**
   * 是否正在监听
   */
  get isMonitoring() {
    return this.monitor.isMonitoring
  }

  /**
   * 标记信息列表
   */
  get markItemInfos(): Ref<MarkItemInfo[]> {
    return this.manager.markItemInfos
  }

  /**
   * 当前标记信息
   */
  get currentMarkItemInfo(): Ref<MarkItemInfo | null> {
    return this.manager.currentMarkItemInfo
  }

  /**
   * 选中的内容
   */
  get selectContent(): Ref<MarkSelectContent[]> {
    return this.manager.selectContent
  }
}
