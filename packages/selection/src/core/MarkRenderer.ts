import { fixCssSelector, getTextNodesInRange, removeOuterTag } from '@commons/utils/dom'
import { HighlightRange } from '@commons/utils/range'
import type { MarkPathItem } from '@commons/types/interface'

import { Base } from './Base'
import type { DrawMarkBaseInfo, MarkItemInfo, SelectionConfig } from '../types'
import type { IEnvironmentAdapter, IUserProvider } from '../adapters'

/**
 * 标记渲染器
 *
 * 负责在页面上绘制、更新和删除标记（划线和评论）
 */
export class MarkRenderer extends Base {
  private _handleMarkClickHandler?: (ele: HTMLElement, event: PointerEvent) => void
  private userProvider: IUserProvider

  constructor(config: SelectionConfig, environmentAdapter: IEnvironmentAdapter, userProvider: IUserProvider) {
    super(config, environmentAdapter)
    this.userProvider = userProvider
  }

  /**
   * 绘制标记
   * @param info 标记信息
   * @param action 操作类型（创建或更新）
   * @returns 标记ID
   */
  async drawMark(info: MarkItemInfo, action: 'create' | 'update' = 'create') {
    const userId = this.userProvider.getUserId()

    const isComment = info.comments.length > 0
    const isStroke = info.stroke.length > 0
    const isSelfStroke = !!info.stroke.find(item => item.userId === userId)

    if (action === 'create') {
      const baseInfo = {
        id: info.id,
        isStroke,
        isComment,
        isSelfStroke
      } as DrawMarkBaseInfo

      let drawMark = false
      for (const markItem of info.source) {
        if (!isStroke && !isComment) continue

        const infos = this.transferNodeInfos(markItem)
        for (const infoItem of infos) {
          if (infoItem.type === 'image') {
            this.addImageMark({ ...baseInfo, ele: infoItem.ele as HTMLImageElement })
            continue
          }
          this.addMark({ ...baseInfo, node: infoItem.node, start: infoItem.start, end: infoItem.end })
        }

        drawMark = infos.length > 0
      }

      // 近似匹配兜底；空标记不画
      if (!drawMark && info.approx && (isStroke || isComment)) {
        const rangeSvc = new HighlightRange(this.document, this.config.monitorDom!)
        const newRange = rangeSvc.getRange(info.approx)
        if (newRange) {
          this.addMarksInRange(newRange, baseInfo)
        }
      }
    } else {
      // 更新已存在的标记
      // 统一 root，避免作用域不一致
      const root: ParentNode = this.config.containerDom ?? this.document
      const slaxMarks = Array.from(root.querySelectorAll(`slax-mark[data-uuid="${info.id}"]`))
      slaxMarks.forEach(mark => {
        if (isStroke) mark.classList.add('slax-mk-stroke')
        else mark.classList.remove('slax-mk-stroke')

        if (isComment) mark.classList.add('slax-mk-comment')
        else mark.classList.remove('slax-mk-comment')

        if (isSelfStroke) mark.classList.add('slax-mk-self-stroke')
        else mark.classList.remove('slax-mk-self-stroke')

        if (!isStroke && !isComment) removeOuterTag(mark)
      })
    }

    // 行末评论 icon：取本条全部段
    // 给尾段打/清 comment-tail
    if (this.config.commentTailIndicator) {
      const tailRoot: ParentNode = this.config.containerDom ?? this.document
      const tailMarks = Array.from(tailRoot.querySelectorAll<HTMLElement>(`slax-mark[data-uuid="${info.id}"]`))
      this.markCommentTail(isComment, tailMarks)
    }

    return info.id
  }

  // 给带评论划线的尾段打 comment-tail
  // 幂等：先清后标
  private markCommentTail(isComment: boolean, marks: HTMLElement[]) {
    if (!this.config.commentTailIndicator) return
    marks.forEach(m => m.classList.remove('slax-mk-comment-tail'))
    if (!isComment || marks.length === 0) return

    // 跳过空段，防止误标尾段
    const hasContent = (m: HTMLElement) => (m.textContent?.trim().length ?? 0) > 0 || Array.from(m.children).some(el => el.tagName === 'IMG')
    const tail = [...marks].reverse().find(hasContent)
    if (!tail) return

    // 末段是图片则跳过（已有 ···）
    if (Array.from(tail.children).some(el => el.tagName === 'IMG')) return
    tail.classList.add('slax-mk-comment-tail')
  }

  /**
   * 清除已绘制标记，重绘前调用
   * 保留临时高亮 data-uuid="0"
   */
  clearAllMarks() {
    // 限本容器，避免误删其他实例
    const root: ParentNode & Node = this.config.containerDom ?? this.document
    for (const mark of Array.from(root.querySelectorAll('slax-mark[data-uuid]'))) {
      if (mark.getAttribute('data-uuid') !== '0') removeOuterTag(mark)
    }
    root.normalize()
  }

  /**
   * 在Range范围内添加标记
   * @param range 范围对象
   * @param baseInfo 标记基础信息
   */
  addMarksInRange(range: Range, baseInfo: DrawMarkBaseInfo) {
    const markHandler = this.addMark.bind(this)

    // 避免生成零宽空 mark
    const hasContent = (node: Node, start: number, end: number) => end > start && (node.textContent || '').slice(start, end).trim().length > 0

    if (range.startContainer === range.endContainer) {
      if (hasContent(range.startContainer, range.startOffset, range.endOffset)) {
        markHandler({
          ...baseInfo,
          node: range.startContainer,
          start: range.startOffset,
          end: range.endOffset
        })
      }
      return
    }

    const nodes = getTextNodesInRange(range, this.document)

    if (nodes.length > 0) {
      if (nodes[0] === range.startContainer && hasContent(nodes[0], range.startOffset, (nodes[0].textContent || '').length)) {
        markHandler({
          ...baseInfo,
          node: nodes[0],
          start: range.startOffset,
          end: (nodes[0].textContent || '').length
        })
      }

      for (let i = 1; i < nodes.length - 1; i++) {
        markHandler({
          ...baseInfo,
          node: nodes[i],
          start: 0,
          end: (nodes[i].textContent || '').length
        })
      }

      if (nodes.length > 1 && nodes[nodes.length - 1] === range.endContainer && hasContent(nodes[nodes.length - 1], 0, range.endOffset)) {
        markHandler({
          ...baseInfo,
          node: nodes[nodes.length - 1],
          start: 0,
          end: range.endOffset
        })
      }
    }
  }

  /**
   * 添加文本标记
   * @param info 标记信息（包含节点、起始和结束位置）
   */
  addMark(info: DrawMarkBaseInfo & { node: Node; start: number; end: number }) {
    const { id, node, start, end, isStroke, isComment, isSelfStroke, isHighlighted } = info
    const range = this.document.createRange()
    range.setStart(node, start)
    range.setEnd(node, end)
    const mark = this.document.createElement('slax-mark')
    mark.dataset.uuid = id
    if (isStroke) mark.classList.add('slax-mk-stroke')
    if (isComment) mark.classList.add('slax-mk-comment')
    if (isSelfStroke) mark.classList.add('slax-mk-self-stroke')
    if (isHighlighted) mark.classList.add('slax-mk-highlighted')

    mark.onclick = e => {
      const target = e.target as HTMLElement
      if (target && this._handleMarkClickHandler) this._handleMarkClickHandler(target, e)
    }

    range.surroundContents(mark)
  }

  /**
   * 添加图片标记
   * @param info 标记信息（包含图片元素）
   */
  addImageMark(info: DrawMarkBaseInfo & { ele: HTMLImageElement }) {
    const { id, ele, isStroke, isComment, isSelfStroke, isHighlighted } = info
    const mark = this.document.createElement('slax-mark')
    mark.dataset.uuid = id
    if (isStroke) mark.classList.add('slax-mk-stroke')
    if (isComment) mark.classList.add('slax-mk-comment')
    if (isSelfStroke) mark.classList.add('slax-mk-self-stroke')
    if (isHighlighted) mark.classList.add('slax-mk-highlighted')

    mark.onclick = e => {
      const target = e.target as HTMLElement
      if (target && this._handleMarkClickHandler) this._handleMarkClickHandler(target, e)
      e.stopPropagation()
    }

    ele.parentElement?.insertBefore(mark, ele)
    ele.remove()
    mark.appendChild(ele)
  }

  /**
   * 将标记路径项转换为节点信息
   * @param markItem 标记路径项
   * @returns 节点信息数组
   */
  transferNodeInfos(markItem: MarkPathItem) {
    const infos: ({ start: number; end: number; node: Node; type: 'text' } | { type: 'image'; ele: Element })[] = []

    const path = fixCssSelector(markItem.path)
    if (markItem.type === 'text') {
      const baseElement = this.config.monitorDom?.querySelector(path) as HTMLElement
      if (!baseElement) {
        return infos
      }

      const nodes = this.getAllTextNodes(baseElement)
      const nodeLengths = nodes.map(node => (node.textContent || '').length)

      let startOffset = markItem.start || 0
      const endOffset = markItem.end || 0
      let base = 0

      for (let i = 0; i < nodeLengths.length; i++) {
        if (base + nodeLengths[i] <= startOffset) {
          base += nodeLengths[i]
          continue
        }
        if (endOffset - base <= nodeLengths[i]) {
          infos.push({ type: 'text', start: startOffset - base, end: endOffset - base, node: nodes[i] })
          break
        } else {
          infos.push({ type: 'text', start: startOffset - base, end: nodeLengths[i], node: nodes[i] })
          startOffset += nodeLengths[i] - (startOffset - base)
          base += nodeLengths[i]
        }
      }
    } else if (markItem.type === 'image') {
      let element = this.config.monitorDom?.querySelector(path) as HTMLImageElement
      if (!element || !element.src) {
        // 尝试在slax-mark标签内查找
        const paths = path.split('>')
        const tailIdx = paths.length - 1
        const newPath = [...paths.slice(0, tailIdx), ' slax-mark ', paths[tailIdx]]
        element = this.config.monitorDom?.querySelector(newPath.join('>')) as HTMLImageElement
      }
      infos.push({ type: 'image', ele: element })
    }

    return infos
  }

  /**
   * 获取元素下的所有文本节点
   * @param element HTML元素
   * @returns 文本节点数组
   */
  getAllTextNodes(element: HTMLElement): Node[] {
    const unsupportTags = ['UNSUPPORT-VIDEO', 'SCRIPT', 'STYLE', 'NOSCRIPT']
    const textNodes: Node[] = []
    const traverse = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        textNodes.push(node)
      } else if (node.nodeType === Node.ELEMENT_NODE && unsupportTags.indexOf((node as Element).tagName) === -1) {
        node.childNodes.forEach(child => traverse(child))
      }
    }
    traverse(element)
    return textNodes
  }

  /**
   * 设置标记点击处理器
   * @param handler 点击处理函数
   */
  setMarkClickHandler(handler: (ele: HTMLElement, event: PointerEvent) => void) {
    this._handleMarkClickHandler = handler
  }
}
