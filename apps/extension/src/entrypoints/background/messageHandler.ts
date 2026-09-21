import { type MessageType, MessageTypeAction } from '@/config/message'

import type { AuthService } from '@/entrypoints/background/authService'
import { BrowserService } from '@/entrypoints/background/browserService'

export class MessageHandler {
  constructor(private authService: AuthService) {}

  handleMessage(message: unknown, sendResponse: (response?: unknown) => void) {
    const receiveMessage = message as MessageType

    switch (receiveMessage.action) {
      case MessageTypeAction.OpenWelcome:
        BrowserService.openTab(`${process.env.PUBLIC_BASE_URL}/login?from=extension`)
        return false

      case MessageTypeAction.CheckLogined:
        this.handleCheckLogined(sendResponse)
        return true

      case MessageTypeAction.QueryUserInfo:
        this.authService.queryUserInfo().then(userInfo => sendResponse({ success: true, data: userInfo })).catch(error => sendResponse({ success: false, data: error }))
        return true
    }

    return false
  }

  private async handleCheckLogined(sendResponse: (response?: unknown) => void) {
    try {
      const isLoggedIn = await this.authService.checkLogin()
      sendResponse({ success: isLoggedIn, data: isLoggedIn })
    } catch (error) {
      sendResponse({ success: false, data: error })
    }
  }
}
