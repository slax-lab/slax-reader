import { trimRangeEnd } from '@commons/utils/dom'
import { HighlightRange, type HighlightRangeInfo } from '@commons/utils/range'
import { getRangeTextWithNewlines } from '@commons/utils/string'
import { RESTMethodPath } from '@commons/types/const'
import {
  type MarkDetail,
  type MarkInfo,
  type MarkPathApprox,
  type MarkPathItem,
  type MarkSelectContent,
  MarkType as BackendMarkType,
  type MarkUserInfo,
  type UserList
} from '@commons/types/interface'
import type { Ref } from 'vue'

import { Base } from './Base'
import type { MarkRenderer } from './MarkRenderer'
import { copyText, getUUID, objectDeepEqual } from './utils'
import { type MarkCommentInfo, type MarkItemInfo, MenuType, type SelectionConfig, type SelectTextInfo, type StrokeSelectionMeta, type QuoteData } from '../types'
import type { IEnvironmentAdapter, IUserProvider, IHttpClient, IToastService, II18nService, IBookmarkProvider, ToastType } from '../adapters'

// 重新导出 Ref 类型供外部使用
export type { Ref }

/**
 * MarkModal接口定义
 *
 * 定义了MarkModal需要实现的方法，用于显示菜单和面板
 */
export interface IMarkModal {
  /**
   * 检查面板是否存在
   * @param container 容器元素
   */
  isPanelExist(container?: HTMLDivElement): boolean

  /**
   * 显示选择菜单
   * @param options 菜单配置选项
   */
  showMenus(options: {
    event: MouseEvent | TouchEvent
    isStroked?: boolean
    callback?: (type: MenuType, event: MouseEvent) => void
    positionCallback?: (position: { x: number; y: number }) => void
    noActionCallback?: () => void
  }): void

  /**
   * 显示面板
   * @param options 面板配置选项
   */
  showPanel(options: {
    info: MarkItemInfo
    fallbackYOffset: number
    actionCallback?: (type: MenuType, meta: { comment: string; info: MarkItemInfo; replyToUid?: string; event?: MouseEvent }) => void
    commentDeleteCallback?: (id: string, markUid: string) => void
    dismissCallback?: () => void
  }): void

  /**
   * 关闭面板
   */
  dismissPanel(): Promise<void>
}

/**
 * MarkManager依赖项接口
 */
export interface MarkManagerDependencies {
  /** 用户信息提供者 */
  userProvider: IUserProvider
  /** HTTP客户端 */
  httpClient: IHttpClient
  /** Toast提示服务 */
  toastService: IToastService
  /** 国际化服务 */
  i18nService: II18nService
  /** 书签信息提供者 */
  bookmarkProvider: IBookmarkProvider
  /** 用于创建响应式引用的工厂函数（必需，必须使用 Vue 的 ref） */
  refFactory: <T>(value: T) => Ref<T>
  /** 获取标记类型的函数（必需，不同环境有不同实现） */
  getMarkType: (type: 'comment' | 'reply' | 'line') => BackendMarkType
}

/**
 * 标记管理器
 *
 * 负责管理标记（划线和评论）的生命周期，包括：
 * - 绘制标记
 * - 添加/删除划线
 * - 添加/删除评论
 * - 复制标记内容
 * - 与后端API交互
 *
 * 通过适配器模式统一dweb和extensions的实现差异
 */
export class MarkManager extends Base {
  private _markItemInfos: Ref<MarkItemInfo[]>
  // 重绘代际：新重绘作废进行中的旧重绘
  private _drawGeneration = 0
  private _currentMarkItemInfo: Ref<MarkItemInfo | null>
  private _selectContent: Ref<MarkSelectContent[]>
  private _findQuote: (quote: QuoteData) => void
  private _highlightRange: HighlightRange

  // 依赖项
  private userProvider: IUserProvider
  private httpClient: IHttpClient
  private toastService: IToastService
  private i18nService: II18nService
  private bookmarkProvider: IBookmarkProvider
  private getMarkType: (type: 'comment' | 'reply' | 'line') => BackendMarkType

  // 渲染器和模态框
  private renderer: MarkRenderer
  private modal: IMarkModal

  /**
   * 构造函数
   * @param config Selection配置
   * @param environmentAdapter 环境适配器
   * @param dependencies 依赖项集合
   * @param renderer 标记渲染器
   * @param modal 标记模态框
   * @param findQuote 查找引用回调
   */
  constructor(
    config: SelectionConfig,
    environmentAdapter: IEnvironmentAdapter,
    dependencies: MarkManagerDependencies,
    renderer: MarkRenderer,
    modal: IMarkModal,
    findQuote: (quote: QuoteData) => void
  ) {
    super(config, environmentAdapter)

    this.userProvider = dependencies.userProvider
    this.httpClient = dependencies.httpClient
    this.toastService = dependencies.toastService
    this.i18nService = dependencies.i18nService
    this.bookmarkProvider = dependencies.bookmarkProvider
    this.getMarkType = dependencies.getMarkType

    this.renderer = renderer
    this.modal = modal
    this._findQuote = findQuote

    // 使用 Vue 的 ref 创建响应式引用
    const refFactory = dependencies.refFactory
    this._markItemInfos = refFactory<MarkItemInfo[]>([])
    this._currentMarkItemInfo = refFactory<MarkItemInfo | null>(null)
    this._selectContent = refFactory<MarkSelectContent[]>([])

    this._highlightRange = new HighlightRange(this.document)
    this.renderer.setMarkClickHandler(this.handleMarkClick.bind(this))
  }

  /**
   * 绘制所有标记
   * @param marks 标记详情数据
   */
  async drawMarks(marks: MarkDetail) {
    // 重绘前清旧标记，避免重复与残留
    const gen = ++this._drawGeneration
    this.renderer.clearAllMarks()
    const userMap = this.createUserMap(marks.user_list)
    const commentMap = this.buildCommentMap(marks.mark_list, userMap)
    this.buildCommentRelationships(marks.mark_list, commentMap)
    const infos = (this._markItemInfos.value = this.generateMarkItemInfos(marks.mark_list, commentMap))
    for (const info of infos) {
      // 有更新的重绘则中止
      if (gen !== this._drawGeneration) return
      await this.renderer.drawMark(info)
    }
  }

  /**
   * 添加划线或评论
   * @param meta 划线选择元数据
   * @returns 标记信息ID
   */
  async strokeSelection(meta: StrokeSelectionMeta) {
    const { info, comment, replyToUid } = meta

    const approx = info.approx
    const markItems = info.source
    const userInfo = this.userProvider.getUserInfo()

    // TODO 需要检查这个逻辑修复的具体内容是什么
    // if (info.stroke.find(item => item.userId === userInfo?.userId) && !comment) {
    //   console.log('strokeSelection return info.id', info.id)
    //   return info.id
    // }

    const infoItem = info
    const replyToComment = replyToUid ? this.findCommentByUid(replyToUid, infoItem) : null
    const commentItem: MarkCommentInfo | null = comment
      ? {
          markUid: '',
          comment,
          userId: userInfo?.userId || 0,
          username: userInfo?.name || '',
          avatar: userInfo?.picture || '',
          isDeleted: false,
          rootUid: '',
          reply: replyToUid
            ? {
                uid: replyToUid,
                username: replyToComment?.username || '',
                userId: replyToComment?.userId || 0,
                avatar: replyToComment?.avatar || ''
              }
            : undefined,
          createdAt: new Date(),
          children: [],
          showInput: false,
          loading: true,
          operateLoading: false
        }
      : null

    const isUpdate = !!this._markItemInfos.value.find(item => item.id === infoItem.id)
    if (!isUpdate) this._markItemInfos.value.push(infoItem)

    if (commentItem) {
      if (replyToUid) {
        const rootComment = infoItem.comments.find(item => item.markUid === replyToUid || item.children.some(child => child.markUid === replyToUid))
        if (rootComment) rootComment.children.push(commentItem)
      } else {
        infoItem.comments.push(commentItem)
      }
    } else {
      infoItem.stroke.push({ mark_uid: '', userId: userInfo?.userId || 0, createdAt: new Date() })
    }

    const markType = commentItem ? (replyToUid ? this.getMarkType('reply') : this.getMarkType('comment')) : this.getMarkType('line')
    await this.renderer.drawMark(infoItem, isUpdate ? 'update' : 'create')

    let res: { mark_uid: string; root_uid: string } | null = null
    let saveError: unknown
    try {
      res = await this.saveMarkSelectContent(markItems, markType, approx, comment, replyToUid)
    } catch (error) {
      saveError = error
    }

    if (!res) {
      this.toastService.showToast({
        text:
          saveError instanceof Error && saveError.message
            ? saveError.message
            : commentItem
              ? this.i18nService.t('component.article_selection.comment_failed')
              : this.i18nService.t('component.article_selection.stroke_failed'),
        type: 'error' as ToastType
      })

      if (commentItem) {
        if (replyToUid) {
          const rootComment = infoItem.comments.find(item => item.markUid === replyToUid || item.children.some(child => child.markUid === replyToUid))
          if (rootComment) {
            const index = rootComment.children.findIndex(item => objectDeepEqual(item, commentItem))
            if (index !== -1) rootComment.children.splice(index, 1)
          }
        } else {
          const index = infoItem.comments.findIndex(item => objectDeepEqual(item, commentItem))
          if (index !== -1) infoItem.comments.splice(index, 1)
        }
      } else {
        infoItem.stroke = infoItem.stroke.filter(item => item.mark_uid !== '')
      }
      await this.renderer.drawMark(infoItem, 'update')
      return
    }

    if (commentItem) {
      commentItem.loading = false
      commentItem.markUid = res.mark_uid
      commentItem.rootUid = res.root_uid
      infoItem.comments = [...infoItem.comments]
    } else {
      infoItem.stroke = [
        ...infoItem.stroke.filter(item => item.userId !== userInfo?.userId && !!item.mark_uid),
        { mark_uid: res.mark_uid, userId: userInfo?.userId || 0, createdAt: new Date() }
      ]
    }
    await this.renderer.drawMark(infoItem, 'update')
    return infoItem.id
  }

  /**
   * 删除划线
   * @param info 标记信息
   */
  async deleteStroke(info: MarkItemInfo) {
    const userId = this.userProvider.getUserId()
    if (!userId) return

    const markUid = info.stroke.find(item => item.userId === userId)?.mark_uid
    if (!markUid) return

    // 公开快照页只有 bookmarkUid，跳过 getBookmarkId 以免抛错
    const bookmarkUid = this.bookmarkProvider.getBookmarkUid?.()
    const bookmarkId = bookmarkUid ? undefined : await this.bookmarkProvider.getBookmarkId()
    await this.httpClient.post({
      url: RESTMethodPath.DELETE_MARK,
      body: { bm_id: bookmarkId, bookmark_uid: bookmarkUid, mark_uid: markUid }
    })

    info.stroke = info.stroke.filter(item => item.userId !== userId)
    if (info.stroke.length === 0 && info.comments.length === 0) {
      const index = this._markItemInfos.value.findIndex(item => item.id === info.id)
      this._markItemInfos.value.splice(index, 1)
    }
    await this.renderer.drawMark(info, 'update')
    await this.modal.dismissPanel()
  }

  /**
   * 删除评论
   * @param id 标记信息ID
   * @param markUid 评论UID
   */
  async deleteComment(id: string, markUid: string) {
    const markInfoItem = id === this._currentMarkItemInfo.value?.id ? this._currentMarkItemInfo.value : this._markItemInfos.value.find(item => item.id === id)
    if (!markInfoItem || !markInfoItem.comments) return

    const removeMarkOrComment = async () => {
      for (const [idx, comment] of markInfoItem.comments.entries()) {
        if (comment.markUid === markUid) {
          const keepMarks = !!comment.children.find(item => !item.isDeleted)
          if (keepMarks) {
            markInfoItem.comments[idx].isDeleted = true
          } else {
            markInfoItem.comments.splice(idx, 1)
          }

          break
        }

        for (const child of comment.children) {
          if (child.markUid === markUid) {
            child.isDeleted = true
            break
          }
        }
      }

      await this.renderer.drawMark(markInfoItem, 'update')

      if (markInfoItem.stroke.length === 0 && markInfoItem.comments.length === 0) {
        const index = this._markItemInfos.value.findIndex(item => item.id === markInfoItem.id)
        this._markItemInfos.value.splice(index, 1)
      }
    }

    try {
      // 公开快照页只有 bookmarkUid，跳过 getBookmarkId 以免抛错
      const bookmarkUid = this.bookmarkProvider.getBookmarkUid?.()
      const bookmarkId = bookmarkUid ? undefined : await this.bookmarkProvider.getBookmarkId()
      await this.httpClient.post({
        url: RESTMethodPath.DELETE_MARK,
        body: { bm_id: bookmarkId, bookmark_uid: bookmarkUid, mark_uid: markUid }
      })

      await removeMarkOrComment()
    } catch (e) {
      console.error(e)
    }
  }

  /**
   * 复制标记文本
   * @param infos 标记信息（包含source、approx和event）
   */
  async copyMarkedText(infos: { source?: MarkPathItem[]; approx?: MarkPathApprox; event?: MouseEvent }) {
    const { source, approx, event } = infos
    const texts: string[] = []

    if (approx) {
      texts.push(approx.raw_text ?? approx.exact)
    } else if (source && source.length > 0) {
      let lastNode: Node | null = null
      for (const markItem of source) {
        const infos = this.renderer.transferNodeInfos(markItem)
        for (const info of infos) {
          if (info.type === 'image') continue
          const range = this.document.createRange()
          range.setStart(info.node, info.start)
          range.setEnd(info.node, info.end)

          if (
            lastNode &&
            lastNode.parentElement?.nextElementSibling !== info.node.parentElement &&
            lastNode.parentElement?.parentElement?.nextElementSibling !== info.node.parentElement
          ) {
            texts.push('\n')
          }
          texts.push(range.toString())
          if (lastNode !== info.node) lastNode = info.node
        }
      }
    }

    const text = texts.join('')
    copyText(text)

    if (event) {
      // 如果提供了showCursorToast，则使用光标Toast
      if (this.toastService.showCursorToast) {
        this.toastService.showCursorToast({
          text: this.i18nService.t('common.tips.copy_content_success'),
          trackDom: event.target as HTMLElement
        })
      } else {
        this.toastService.showToast({
          text: this.i18nService.t('common.tips.copy_content_success'),
          type: 'success' as ToastType
        })
      }
    } else {
      this.toastService.showToast({
        text: this.i18nService.t('common.tips.copy_content_success'),
        type: 'success' as ToastType
      })
    }
  }

  /**
   * 检查两个标记源是否相同
   * @param mark1 标记源1
   * @param mark2 标记源2
   * @returns 是否相同
   */
  checkMarkSourceIsSame(mark1: MarkPathItem[], mark2: MarkPathItem[]) {
    // TODO: 需要使其兼容approx的情况
    if (mark1.length !== mark2.length) return false

    for (let i = 0; i < mark1.length; i++) {
      const mark1Item = mark1[i]
      const mark2Item = mark2[i]
      if (mark1Item.type !== mark2Item.type) return false

      if (mark1Item.type === 'text' && mark2Item.type === 'text') {
        if (mark1Item.path !== mark2Item.path || mark1Item.start !== mark2Item.start || mark1Item.end !== mark2Item.end) {
          return false
        }
      } else if (mark1Item.type === 'image' && mark2Item.type === 'image') {
        if (mark1Item.path !== mark2Item.path && mark1Item.path.replace(/(\s*>\s*|)\s*img\s*$/, '') !== mark2Item.path.replace(/(\s*>\s*|)\s*img\s*$/, '')) {
          const ele1 = this.config.monitorDom?.querySelector(mark1Item.path) as HTMLImageElement
          const ele2 = this.config.monitorDom?.querySelector(mark2Item.path) as HTMLImageElement
          if (ele1 !== ele2) return false
        }
      }
    }

    return true
  }

  /**
   * 显示菜单
   * @param 点击事件
   */
  showMenus(event: MouseEvent | PointerEvent) {
    this.modal.showMenus({
      event,
      isStroked: this._currentMarkItemInfo.value ? this._currentMarkItemInfo.value.stroke.length > 0 : false,
      callback: (type, menuEvent) => {
        const currentInfo = this._currentMarkItemInfo.value
        if (!currentInfo) return

        if (type === MenuType.Stroke) {
          this.strokeSelection({ info: currentInfo })
        } else if (type === MenuType.Stroke_Delete) {
          this.deleteStroke(currentInfo)
        } else if (type === MenuType.Copy) {
          this.copyMarkedText({ source: currentInfo.source, approx: currentInfo.approx, event: menuEvent })
        } else if (type === MenuType.Comment) {
          if (this.config.menusCommentHandler) {
            this.config.menusCommentHandler?.(currentInfo, this.createQuote(currentInfo.source, currentInfo.approx))
          } else {
            this.showPanel()
          }
        } else if (type === MenuType.Chatbot && this.config.postQuoteDataHandler) {
          const quote = { source: { id: currentInfo.id }, data: this.createQuote(currentInfo.source, currentInfo.approx) }
          this.config.postQuoteDataHandler(quote)
          this._findQuote(quote)
        }
      },
      noActionCallback: () => {
        this.updateCurrentMarkItemInfo(null)
        this.clearSelectContent()
      }
    })
  }

  /**
   * 显示面板
   * @param options 显示选项
   */
  showPanel(options?: { fallbackYOffset: number }) {
    if (!this._currentMarkItemInfo.value) return

    const currentMarkItemInfo = this._currentMarkItemInfo.value
    this.modal.showPanel({
      info: this._currentMarkItemInfo.value,
      fallbackYOffset: options?.fallbackYOffset || 0,
      actionCallback: (type, meta) => {
        if (type === MenuType.Stroke) this.strokeSelection(meta as StrokeSelectionMeta)
        else if (type === MenuType.Stroke_Delete) this.deleteStroke(meta.info)
        else if (type === MenuType.Copy) this.copyMarkedText({ source: meta.info.source, approx: meta.info.approx, event: meta.event })
        else if (type === MenuType.Comment) this.strokeSelection(meta as StrokeSelectionMeta)
        else if (type === MenuType.Chatbot && this.config.postQuoteDataHandler) {
          const quote = { source: { id: meta.info.id }, data: this.createQuote(meta.info.source, meta.info.approx) }
          this.config.postQuoteDataHandler(quote)
          this._findQuote(quote)
        }
      },
      commentDeleteCallback: (id, markUid) => this.deleteComment(id, markUid),
      dismissCallback: () => {
        if (this._currentMarkItemInfo.value === currentMarkItemInfo) {
          this.updateCurrentMarkItemInfo(null)
          this.clearSelectContent()
        }
      }
    })
  }

  /**
   * 创建引用数据
   * @param items 标记路径项数组
   * @param approx 近似匹配信息
   * @returns 引用数据
   */
  createQuote(items: MarkPathItem[], approx?: MarkPathApprox): QuoteData['data'] {
    return items.map(item => {
      if (item.type === 'image') {
        const infos = this.renderer.transferNodeInfos(item)
        const content = infos.length > 0 && infos[0].type === 'image' ? (infos[0].ele as HTMLImageElement).src : ''
        return { type: 'image', content }
      }

      const infos = this.renderer.transferNodeInfos(item)

      if (infos.length > 0) {
        const text = infos
          .map(info => {
            if (info.type === 'image') return ''
            const range = this.document.createRange()
            range.setStart(info.node, info.start)
            range.setEnd(info.node, info.end)
            return range.toString()
          })
          .join('')
        return { type: 'text', content: text }
      } else if (approx) {
        const rangeSvc = new HighlightRange(this.window.document)
        const range = rangeSvc.getRange(approx)
        return { type: 'text', content: range?.toString() || '' }
      }

      return { type: 'text', content: '' }
    })
  }

  /**
   * 获取元素信息（包含选择的元素列表和近似文本）
   * @param range 范围对象
   * @returns 元素信息
   */
  getElementInfo(range: Range): { list: SelectTextInfo[]; approx: HighlightRangeInfo | undefined } {
    // 避免影响原生选区高亮
    const trimmedRange = trimRangeEnd(range.cloneRange(), this.document)
    const list = this.getElementsList(trimmedRange)
    const approx = this.getApproxText(trimmedRange)

    return {
      list,
      approx
    }
  }

  /**
   * 获取近似文本信息
   * @param range 范围对象
   * @returns 近似文本信息
   */
  getApproxText(range: Range): HighlightRangeInfo | undefined {
    if (!range || range.collapsed || range.toString().trim().length === 0) {
      return undefined
    }

    const approx = this._highlightRange.getSelector(range)
    return approx
  }

  /**
   * 获取选择的元素列表
   * @param range 范围对象
   * @returns 选择的元素列表
   */
  getElementsList(range: Range): SelectTextInfo[] {
    if (!range) {
      return []
    }

    const selectedInfo: SelectTextInfo[] = []

    const isNodeFullyInRange = (node: Node) => {
      const nodeRange = this.document.createRange()
      nodeRange.selectNodeContents(node)
      return range.compareBoundaryPoints(Range.START_TO_START, nodeRange) <= 0 && range.compareBoundaryPoints(Range.END_TO_END, nodeRange) >= 0
    }

    const isNodePartiallyInRange = (node: Node) => range.intersectsNode(node)

    const processTextNode = (textNode: Text) => {
      if (!isNodePartiallyInRange(textNode)) return

      let startOffset = textNode === range.startContainer ? range.startOffset : 0
      let endOffset = textNode === range.endContainer ? range.endOffset : textNode.length
      startOffset = Math.max(0, Math.min(startOffset, textNode.length))
      endOffset = Math.max(startOffset, Math.min(endOffset, textNode.length))

      if (endOffset > startOffset) {
        selectedInfo.push({
          type: 'text',
          node: textNode,
          startOffset,
          endOffset,
          text: textNode.textContent!.slice(startOffset, endOffset)
        })
      }
    }

    const processNode = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE && (node.textContent?.trim() || '').length > 0) {
        processTextNode(node as Text)
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as HTMLElement
        if (element.tagName === 'IMG' && isNodeFullyInRange(element)) {
          selectedInfo.push({ type: 'image', src: (element as HTMLImageElement).src, ele: element })
        }
        if (isNodePartiallyInRange(element)) {
          for (const child of element.childNodes) processNode(child)
        }
      }
    }

    processNode(range.commonAncestorContainer)
    return selectedInfo.length > 0 && !selectedInfo.every(item => item.type === 'text' && item.text.trim().length === 0) ? selectedInfo : []
  }

  /**
   * 更新当前标记信息
   * @param info 标记信息
   */
  updateCurrentMarkItemInfo(info: MarkItemInfo | null) {
    this._currentMarkItemInfo.value = info
  }

  /**
   * 添加选择内容
   * @param content 选择内容
   */
  pushSelectContent(content: MarkSelectContent) {
    this._selectContent.value.push(content)
  }

  /**
   * 清空选择内容
   */
  clearSelectContent() {
    this._selectContent.value = []
  }

  /**
   * 保存标记选择内容到后端
   * @param value 标记路径项数组
   * @param type 标记类型
   * @param approx 近似匹配信息
   * @param comment 评论内容
   * @param replyToUid 回复目标UID
   * @returns 保存结果
   */
  private async saveMarkSelectContent(value: MarkPathItem[], type: BackendMarkType, approx?: MarkPathApprox, comment?: string, replyToUid?: string) {
    const bookmarkUid = this.bookmarkProvider.getBookmarkUid?.()
    const shareCode = this.bookmarkProvider.getShareCode?.()
    const collectionInfo = this.bookmarkProvider.getCollectionInfo?.()
    // 公开快照页只有 bookmarkUid，跳过 getBookmarkId 以免抛错或发出被后端优先解析的伪造 bm_id:0
    const bookmarkId = bookmarkUid ? undefined : await this.bookmarkProvider.getBookmarkId()

    const res = await this.httpClient.post<{ mark_uid: string; root_uid: string }>({
      url: RESTMethodPath.ADD_MARK,
      body: {
        share_code: shareCode,
        bm_id: bookmarkId,
        bookmark_uid: bookmarkUid,
        comment,
        type,
        source: value,
        parent_uid: replyToUid,
        select_content: this._selectContent.value,
        approx_source: approx,
        collection_code: collectionInfo?.code,
        cb_id: collectionInfo?.cb_id
      }
    })
    return res || null
  }

  /**
   * 创建用户映射表
   * @param userList 用户列表
   * @returns 用户映射表
   */
  private createUserMap(userList: UserList): Map<number, MarkUserInfo> {
    return new Map(Object.entries(userList).map(([key, value]) => [Number(key), value]))
  }

  /**
   * 构建评论映射表
   * @param markList 标记列表
   * @param userMap 用户映射表
   * @returns 评论映射表
   */
  private buildCommentMap(markList: MarkInfo[], userMap: Map<number, MarkUserInfo>): Map<string, MarkCommentInfo> {
    const commentMap = new Map<string, MarkCommentInfo>()
    for (const mark of markList) {
      if ([BackendMarkType.COMMENT, BackendMarkType.REPLY, BackendMarkType.ORIGIN_COMMENT].includes(mark.type)) {
        const comment = {
          markUid: mark.uuid,
          comment: mark.comment,
          userId: mark.user_id,
          username: userMap.get(mark.user_id)?.username || '',
          avatar: userMap.get(mark.user_id)?.avatar || '',
          isDeleted: mark.is_deleted,
          children: [],
          createdAt: new Date(mark.created_at),
          rootUid: mark.root_uid,
          showInput: false,
          loading: false,
          operateLoading: false
        }

        commentMap.set(mark.uuid, comment)
      }
    }
    return commentMap
  }

  /**
   * 构建评论关系（回复关系）
   * @param markList 标记列表
   * @param commentMap 评论映射表
   */
  private buildCommentRelationships(markList: MarkInfo[], commentMap: Map<string, MarkCommentInfo>) {
    for (const mark of markList) {
      if (mark.type !== BackendMarkType.REPLY) continue
      if (!commentMap.has(mark.uuid) || !commentMap.has(mark.parent_uid) || !commentMap.has(mark.root_uid)) continue

      const comment = commentMap.get(mark.uuid)!
      const parentComment = commentMap.get(mark.parent_uid)!
      comment.reply = {
        uid: parentComment.markUid,
        username: parentComment.username,
        userId: parentComment.userId,
        avatar: parentComment.avatar
      }
      const rootComment = commentMap.get(comment.rootUid!)
      if (rootComment) rootComment.children.push(comment)
    }
  }

  /**
   * 生成标记信息列表
   * @param markList 标记列表
   * @param commentMap 评论映射表
   * @returns 标记信息列表
   */
  private generateMarkItemInfos(markList: MarkInfo[], commentMap: Map<string, MarkCommentInfo>): MarkItemInfo[] {
    const rangeSvc = new HighlightRange(this.document, this.config.monitorDom!)
    const infoItems: MarkItemInfo[] = []
    for (const mark of markList) {
      const userId = mark.user_id
      const source = mark.source
      if (typeof source === 'number' || mark.type === BackendMarkType.REPLY) continue
      if ([BackendMarkType.ORIGIN_LINE, BackendMarkType.ORIGIN_COMMENT].includes(mark.type) && (!mark.approx_source || Object.keys(mark.approx_source).length === 0)) continue

      const markSources = source as MarkPathItem[]
      let markInfoItem = infoItems.find(infoItem => this.checkMarkSourceIsSame(infoItem.source, markSources))

      if (!markInfoItem) {
        try {
          if (mark.approx_source && Object.keys(mark.approx_source).length > 0) {
            const newRange = rangeSvc.getRange(mark.approx_source)
            const rawText = newRange ? getRangeTextWithNewlines(newRange) : undefined
            mark.approx_source.raw_text = rawText
          }
        } catch (error) {
          console.error('create raw text failed', error, mark.approx_source?.exact)
        }

        markInfoItem = { id: getUUID(), source: markSources, comments: [], stroke: [], approx: mark.approx_source }
        infoItems.push(markInfoItem)
      }

      if ([BackendMarkType.LINE, BackendMarkType.ORIGIN_LINE].includes(mark.type)) {
        if (!mark.comment && mark.is_deleted) continue
        markInfoItem.stroke.push({ mark_uid: mark.uuid, userId, createdAt: new Date(mark.created_at) })
      } else if ([BackendMarkType.COMMENT, BackendMarkType.ORIGIN_COMMENT].includes(mark.type)) {
        const comment = commentMap.get(mark.uuid)
        if (!comment || (comment.isDeleted && comment.children.length === 0)) {
          continue
        }

        markInfoItem.comments.push(comment)
      }
    }

    // 剔除空 info（已删标记残留）
    // 否则会画出无 class 的残留
    return infoItems.filter(info => info.stroke.length > 0 || info.comments.length > 0)
  }

  /**
   * 根据ID查找评论
   * @param targetId 目标评论ID
   * @param infoItem 标记信息
   * @returns 评论信息或null
   */
  private findCommentByUid(targetUid: string, infoItem: MarkItemInfo): MarkCommentInfo | null {
    for (const item of infoItem.comments) {
      if (item.markUid === targetUid) return item
      for (const child of item.children) {
        if (child.markUid === targetUid) return child
      }
    }
    return null
  }

  /**
   * 处理标记点击事件
   * @param ele 被点击的元素
   * @param event 点击事件
   */
  private handleMarkClick(ele: HTMLElement, event: PointerEvent) {
    const id = ele.dataset.uuid
    if (!id) return

    const infoItem = this._markItemInfos.value.find(item => item.id === id)
    if (!infoItem) return

    if ((!infoItem.approx || Object.keys(infoItem.approx).length === 0) && infoItem.source.length > 0) {
      // 这里兼容无approx的数据

      try {
        const walker = this.document.createTreeWalker(ele, NodeFilter.SHOW_TEXT)

        let firstTextNode: Text | null = null
        let lastTextNode: Text | null = null
        while (walker.nextNode()) {
          const node = walker.currentNode as Text
          if (!firstTextNode) firstTextNode = node
          lastTextNode = node
        }

        if (firstTextNode && lastTextNode) {
          const range = this.document.createRange()
          range.setStart(firstTextNode, 0)
          range.setEnd(lastTextNode, lastTextNode.length)

          infoItem.approx = this.getApproxText(range)
        }
      } catch (error) {
        console.error(error)
      }
    }

    this.updateCurrentMarkItemInfo(infoItem)

    if (this.config.markCommentSelectHandler) {
      if (this._currentMarkItemInfo.value && this._currentMarkItemInfo.value.comments.length > 0) {
        this.config.markCommentSelectHandler?.(this._currentMarkItemInfo.value.comments[0])
      }

      this.showMenus(event)
    } else {
      this.showPanel()
    }
  }

  /**
   * 获取标记信息列表（响应式）
   */
  get markItemInfos() {
    return this._markItemInfos
  }

  /**
   * 获取当前标记信息（响应式）
   */
  get currentMarkItemInfo() {
    return this._currentMarkItemInfo
  }

  /**
   * 获取选择内容（响应式）
   */
  get selectContent() {
    return this._selectContent
  }
}
