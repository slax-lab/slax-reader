/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * App Bridge communication utilities for iOS and Android
 * Handles message sending and receiving between WebView and native app
 */

import { AppPlatform } from './appUserAgent'

export type BridgeMessage<T = any> = {
  type: string
} & T

export interface BridgeResponse<T = any> {
  success: boolean
  data?: T
  error?: string
}

type BridgeMessageHandler<T = any> = (data: T) => void

/**
 * Bridge communication manager
 */
class AppBridge {
  private platform: AppPlatform
  private messageHandlers: Map<string, Set<BridgeMessageHandler>>

  constructor() {
    this.platform = this.detectPlatform()
    this.messageHandlers = new Map()
    this.setupMessageListener()
  }

  /**
   * Setup global message listener for receiving messages from native app
   */
  private setupMessageListener() {
    if (typeof window === 'undefined') {
      return
    }

    // iOS uses window.webkit.messageHandlers
    // Android uses window.nativeBridge or postMessage
    window.addEventListener('message', event => {
      try {
        const message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        this.handleMessage(message)
      } catch (error) {
        console.error('Failed to parse bridge message:', error)
      }
    })
  }

  /**
   * Handle incoming message from native app
   */
  private handleMessage(message: BridgeMessage) {
    const handlers = this.messageHandlers.get(message.type)
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(message.data)
        } catch (error) {
          console.error(`Error in bridge message handler for type "${message.type}":`, error)
        }
      })
    }
  }

  /**
   * Send message to native app
   */
  sendMessage<T = any>(type: string, data?: T): void {
    const message = { type, ...data }
    if (this.platform === AppPlatform.iOS) {
      this.sendToiOS(message)
    } else if (this.platform === AppPlatform.Android) {
      this.sendToAndroid(message)
    } else {
      console.warn('Bridge message not sent: not running in SlaxReader app')
    }
  }

  /**
   * Send message to iOS native app via webkit messageHandlers
   */
  private sendToiOS(message: BridgeMessage): void {
    try {
      const webkit = (window as any).webkit
      if (webkit?.messageHandlers?.NativeBridge?.postMessage) {
        webkit.messageHandlers?.NativeBridge.postMessage(JSON.stringify(message))
      } else {
        console.warn('iOS webkit messageHandlers not available')
      }
    } catch (error) {
      console.error('Failed to send message to iOS:', error)
    }
  }

  /**
   * Send message to Android native app
   */
  private sendToAndroid(message: BridgeMessage): void {
    try {
      const nativeBridge = (window as any)?.NativeBridge
      if (nativeBridge?.postMessage) {
        nativeBridge.postMessage(JSON.stringify(message))
      } else {
        console.warn('Android bridge not available')
      }
    } catch (error) {
      console.error('Failed to send message to Android:', error)
    }
  }

  /**
   * Register a message handler for a specific message type
   */
  on<T = any>(type: string, handler: BridgeMessageHandler<T>): void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set())
    }
    this.messageHandlers.get(type)!.add(handler)
  }

  /**
   * Unregister a message handler
   */
  off<T = any>(type: string, handler: BridgeMessageHandler<T>): void {
    const handlers = this.messageHandlers.get(type)
    if (handlers) {
      handlers.delete(handler)
      if (handlers.size === 0) {
        this.messageHandlers.delete(type)
      }
    }
  }

  /**
   * Get current platform
   */
  getPlatform(): AppPlatform {
    return this.platform
  }

  /**
   * Check if running in app
   */
  isInApp(): boolean {
    return this.platform !== AppPlatform.Unknown
  }

  detectPlatform() {
    if ((window as any)?.NativeBridge?.postMessage) {
      return AppPlatform.Android
    }

    if ((window as any)?.webkit?.messageHandlers?.NativeBridge) {
      return AppPlatform.iOS
    }

    return AppPlatform.Unknown
  }
}

// Create singleton instance
export const appBridge = new AppBridge()

// Vue composable for using app bridge
export function useAppBridge() {
  return {
    bridge: appBridge,
    platform: appBridge.getPlatform(),
    isInApp: appBridge.isInApp(),
    sendMessage: appBridge.sendMessage.bind(appBridge),
    on: appBridge.on.bind(appBridge),
    off: appBridge.off.bind(appBridge)
  }
}
