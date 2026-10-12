/// <reference lib="WebWorker" />

declare const self: ServiceWorkerGlobalScope

export class NotificationWorker {
  constructor() {
    this.onPush = this.onPush.bind(this)
    this.onNotificationclick = this.onNotificationclick.bind(this)

    console.log(`[slax sw] notification worker initialize`)
  }

  onWorkerInstall() {
    console.log(`[slax sw] notification worker install`)
    self.skipWaiting()
  }

  onWorkerActivate() {
    console.log(`[slax sw] notification worker activate`)
    self.clients.claim()
  }

  onPush(event: PushEvent) {
    if (!event.data) return
    const data = event.data.json()
    event.waitUntil(this.showNotification(data))
  }

  onNotificationclick(event: NotificationEvent) {
    event.notification.close()

    // 处理通知点击，可以打开特定页面
    const jumpUrl = event.notification.data.url || '/'
    return self.clients.openWindow(jumpUrl)
  }

  initialize() {
    // 注册基础事件
    self.addEventListener('install', this.onWorkerInstall)
    // 监听激活事件
    self.addEventListener('activate', this.onWorkerActivate)
    // 监听推送消息
    self.addEventListener('push', this.onPush)
    // 监听通知点击
    self.addEventListener('notificationclick', this.onNotificationclick)
  }

  async showNotification(data: { title: string; body: string; icon: string; data: unknown }) {
    if (!self.registration) return
    console.log(`[slax sw] notification worker showNotification`)
    return self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      data: data.data,
      requireInteraction: true,
      tag: 'notification'
    })
  }
}
