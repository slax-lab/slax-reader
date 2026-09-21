import { RESTMethodPath } from '@commons/types/const'
import { useCookies } from '@vueuse/integrations/useCookies'
import { registerSW } from 'virtual:pwa-register'

const useNotification = () => {
  const isSupportedSW = computed(() => 'serviceWorker' in navigator)
  const isSupportedNotification = computed(() => 'Notification' in window)
  const $config = useRuntimeConfig().public

  const registerWorker = async () => {
    if (!isSupportedSW.value) {
      console.warn('[slax] NotificationWorker is not supported')
      return null
    }

    return new Promise((resolve, reject) => {
      try {
        registerSW({
          immediate: true,
          onRegisteredSW(swScriptUrl, registration) {
            console.log('[slax] NotificationWorker swScriptUrl:', swScriptUrl)
            console.log('[slax] NotificationWorker registered:', registration)
            initWebsocket()

            resolve(null)
          },
          onRegisterError(error) {
            console.error(error)
            reject(error)
          }
        })
      } catch (error) {
        console.error('[slax] NotificationWorker registration failed:', error)
        reject(error)
      }
    })
  }

  const requestPushPermission = async () => {
    if (!('Notification' in window)) return false
    try {
      const permission = await Notification.requestPermission()
      const isGranted = permission === 'granted'

      if (!isGranted) {
        console.log(await getSubscription())
        return false
      }

      if (!$config.PUSH_API_PUBLIC_KEY) {
        console.error('PUSH_API_PUBLIC_KEY is not set')
        return false
      }

      const options = {
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array($config.PUSH_API_PUBLIC_KEY)
      }

      const subscription = await getSubscription()
      if (!subscription) {
        subscribe(options).then(res => {
          request().post({
            url: RESTMethodPath.SUBSCRIBE_PUSH,
            body: res
          })
        })
      }

      return true
    } catch (error) {
      console.error('[slax] Push permission request failed:', error)
      return false
    }
  }

  const initWebsocket = async () => {
    const cookies = useCookies().get('token')
    if (!cookies) {
      console.warn('[slax] No token found for WebSocket connection')
      return
    }

    try {
      const baseUrl = `${$config.DWEB_API_BASE_URL}`.replace('https', 'wss').replace('http', 'ws')
      const sendData = {
        type: 'connect',
        data: {
          url: `${baseUrl}${RESTMethodPath.CONNECT_MESSAGE}?token=${cookies}`
        }
      }
      await sendMessage(sendData)
    } catch (error) {
      console.error('[slax] WebSocket initialization failed:', error)
    }
  }

  const sendMessage = async (message: unknown) => {
    const registration = await navigator.serviceWorker.ready

    console.log('registration', registration)
    if (!registration.active) {
      throw new Error('No active service worker found')
    }
    registration.active.postMessage(message)
  }

  const onMessage = (callback: (event: MessageEvent) => void) => {
    navigator.serviceWorker.addEventListener('message', callback)
  }

  const getSubscription = async () => {
    const registration = await navigator.serviceWorker.ready
    return registration.pushManager.getSubscription()
  }

  const subscribe = async (options: PushSubscriptionOptionsInit) => {
    const registration = await navigator.serviceWorker.ready
    return registration.pushManager.subscribe(options)
  }

  return {
    isSupportedSW: isSupportedSW.value,
    isSupportedNotification: isSupportedNotification.value,
    registerWorker,
    requestPushPermission,
    initWebsocket,
    sendMessage,
    onMessage,
    getSubscription,
    subscribe
  }
}

export default useNotification
