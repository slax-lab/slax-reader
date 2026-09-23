/**
 * WebSocket 连接状态枚举
 */
enum WebSocketState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3
}

/**
 * WebSocket 事件类型
 */
type WebSocketEventMap = {
  open: Event
  message: MessageEvent
  close: CloseEvent
  error: Event
  reconnect: CustomEvent
}

/**
 * WebSocket 事件处理函数类型
 */
type WebSocketEventHandler<K extends keyof WebSocketEventMap> = (event: WebSocketEventMap[K]) => void

/**
 * WebSocket 配置选项
 */
interface WebSocketOptions {
  url: string
  protocols?: string | string[]
  autoReconnect?: boolean
  reconnectInterval?: number
  maxReconnectAttempts?: number
}

/**
 * 增强型 WebSocket 类
 */
class SlaxWebSocket {
  private ws: WebSocket | null = null
  private url: string
  private protocols?: string | string[]
  private autoReconnect: boolean
  private reconnectInterval: number
  private maxReconnectAttempts: number
  private reconnectAttempts: number = 0
  private eventHandlers: Map<string, Set<Function>> = new Map()
  private isManualClosed: boolean = false
  private pingPongInterval?: NodeJS.Timeout

  /**
   * 构造函数
   * @param options WebSocket配置选项
   */
  constructor(options: WebSocketOptions) {
    this.url = options.url
    this.protocols = options.protocols
    this.autoReconnect = options.autoReconnect ?? true
    this.reconnectInterval = options.reconnectInterval ?? 3000
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5

    this.connect()
  }

  /**
   * 建立WebSocket连接
   */
  private connect(): void {
    try {
      this.ws = new WebSocket(this.url, this.protocols)

      this.ws.onopen = event => {
        this.handleEvent('open', event)
        this.startPing()
      }
      this.ws.onmessage = event => {
        if (event.data === 'pong') {
          return
        }

        this.handleEvent('message', event)
      }
      this.ws.onclose = event => {
        this.handleClose(event)
        this.stopPing()
      }
      this.ws.onerror = event => this.handleEvent('error', event)
    } catch (error) {
      console.error('WebSocket connection error:', error)
      this.attemptReconnect()
    }
  }

  /**
   * 处理WebSocket事件
   * @param type 事件类型
   * @param event 事件对象
   */
  private handleEvent(type: string, event: Event): void {
    const handlers = this.eventHandlers.get(type)
    if (handlers) {
      handlers.forEach(handler => handler(event))
    }
  }

  /**
   * 处理WebSocket关闭事件
   * @param event 关闭事件对象
   */
  private handleClose(event: CloseEvent): void {
    this.handleEvent('close', event)

    if (!this.isManualClosed && this.autoReconnect) {
      this.attemptReconnect()
    }
  }

  /**
   * 尝试重新连接
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn(`WebSocket reconnect failed after ${this.maxReconnectAttempts} attempts`)
      return
    }

    this.reconnectAttempts++

    console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`)

    setTimeout(() => {
      this.connect()

      // 触发重连事件
      const reconnectEvent = new CustomEvent('reconnect', {
        detail: { attempt: this.reconnectAttempts }
      })
      this.handleEvent('reconnect', reconnectEvent)
    }, this.reconnectInterval)
  }

  /**
   * 添加事件监听器
   * @param type 事件类型
   * @param handler 事件处理函数
   */
  public on<K extends keyof WebSocketEventMap>(type: K, handler: WebSocketEventHandler<K>): void {
    if (!this.eventHandlers.has(type)) {
      this.eventHandlers.set(type, new Set())
    }

    this.eventHandlers.get(type)!.add(handler)
  }

  /**
   * 移除事件监听器
   * @param type 事件类型
   * @param handler 事件处理函数
   */
  public off<K extends keyof WebSocketEventMap>(type: K, handler: WebSocketEventHandler<K>): void {
    const handlers = this.eventHandlers.get(type)
    if (handlers) {
      handlers.delete(handler)
    }
  }

  /**
   * 发送数据
   * @param data 要发送的数据
   * @returns 是否发送成功
   */
  public send(data: string | ArrayBuffer | Blob | ArrayBufferView<ArrayBuffer>): boolean {
    if (this.ws && this.ws.readyState === WebSocketState.OPEN) {
      this.ws.send(data)
      return true
    }
    return false
  }

  /**
   * 发送JSON数据
   * @param data 要发送的JSON数据
   * @returns 是否发送成功
   */
  public sendJSON<T extends Record<string | number, unknown>>(data: T): boolean {
    try {
      const jsonString = JSON.stringify(data)
      return this.send(jsonString)
    } catch (error) {
      console.error('Failed to stringify JSON:', error)
      return false
    }
  }

  /**
   * 关闭WebSocket连接
   * @param code 关闭代码
   * @param reason 关闭原因
   */
  public close(code?: number, reason?: string): void {
    this.isManualClosed = true
    if (this.ws) {
      this.ws.close(code, reason)
    }
  }

  /**
   * 获取当前WebSocket连接状态
   */
  public get state(): WebSocketState {
    return this.ws ? this.ws.readyState : WebSocketState.CLOSED
  }

  /**
   * 检查WebSocket是否已连接
   */
  public get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocketState.OPEN
  }

  /**
   * 重置重连计数并重新连接
   */
  public reconnect(): void {
    this.isManualClosed = false
    this.reconnectAttempts = 0

    if (this.ws) {
      this.ws.close()
    }

    this.connect()
  }

  /**
   * 开启定时发送ping消息功能
   */
  private startPing(): void {
    this.pingPongInterval = setInterval(() => {
      if (this.isConnected) {
        this.send('ping')
      }
    }, 30000)
  }

  /**
   * 停止定时发送ping消息功能
   */
  private stopPing(): void {
    if (this.pingPongInterval) {
      clearInterval(this.pingPongInterval)
      this.pingPongInterval = undefined
    }
  }
}

export { SlaxWebSocket, type WebSocketOptions, WebSocketState }
