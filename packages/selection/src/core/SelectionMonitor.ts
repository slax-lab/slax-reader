import { Base } from './Base'
import type { SelectionConfig } from '../types'
import type { IEnvironmentAdapter } from '../adapters'

/**
 * 选择监听器
 *
 * 负责监听用户的鼠标选择操作，触发对应的回调
 * 此类在dweb和extensions中100%相同
 */
export class SelectionMonitor extends Base {
  private _isMonitoring = false
  private _monitorDom: HTMLElement | null = null
  private _mouseUpHandler: (e: MouseEvent | TouchEvent) => void

  constructor(config: SelectionConfig, environmentAdapter: IEnvironmentAdapter, mouseUpHandler: (e: MouseEvent | TouchEvent) => void) {
    super(config, environmentAdapter)
    this._monitorDom = this.config.monitorDom || null
    this._mouseUpHandler = mouseUpHandler
  }

  /**
   * 开始监听
   */
  start() {
    if (!this._monitorDom) return

    const handler = this.mouseUpHandler
    this._monitorDom.addEventListener('mouseup', handler)
    this._monitorDom.addEventListener('touchend', handler)
    this._monitorDom.addEventListener('mousedown', this.handleMouseDown)
    this._isMonitoring = true
  }

  /**
   * 停止监听
   */
  stop() {
    if (!this._monitorDom) return

    this._monitorDom.removeEventListener('mouseup', this.mouseUpHandler)
    this._monitorDom.removeEventListener('touchend', this.mouseUpHandler)
    this._monitorDom.removeEventListener('mousedown', this.handleMouseDown)
    this._isMonitoring = false
  }

  /**
   * 清理尝试性的鼠标监听器
   */
  clearMouseListenerTry() {
    this.document.removeEventListener('mouseup', this.mouseUpHandler)
    this._monitorDom?.removeEventListener('mouseenter', this.handleMouseEnter)
    this._monitorDom?.removeEventListener('mouseleave', this.handleMouseLeave)
  }

  private handleMouseEnter = () => {
    this.document.removeEventListener('mouseup', this.mouseUpHandler)
    this.document.removeEventListener('touchend', this.mouseUpHandler)
  }

  private handleMouseLeave = () => {
    this.document.addEventListener('mouseup', this.mouseUpHandler)
    this.document.addEventListener('touchend', this.mouseUpHandler)
  }

  private handleMouseDown = () => {
    if (!this._monitorDom) return
    this._monitorDom.addEventListener('mouseenter', this.handleMouseEnter)
    this._monitorDom.addEventListener('mouseleave', this.handleMouseLeave)
  }

  /**
   * 获取监听状态
   */
  get isMonitoring() {
    return this._isMonitoring
  }

  /**
   * 获取鼠标抬起处理函数
   */
  get mouseUpHandler() {
    return this._mouseUpHandler
  }
}
