import { createApp } from 'vue'

import CollectPopup from '@/components/Collect.vue'
import SidePanel from '@/components/SidePanel.vue'

import { MessageTypeAction } from '@/config/message'

import { watchPinnedStatus } from '@/utils/pinnedStatus'

import '@/styles/reset.scss'
import 'uno.css'
import { analytics } from '#analytics'

const extensionInvalidate = () => {
  // console.error('extension invalidated')
}

const styleReset = () => {
  document.documentElement.style.transformStyle = 'flat' // revert transformStyle to avoid 3d issue (affecting fixed position)
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  cssInjectionMode: 'ui',
  async main(ctx) {
    styleReset()

    ctx.onInvalidated(extensionInvalidate)
    const collectUI = await createShadowRootUi(ctx, {
      name: 'slax-reader-modal',
      position: 'overlay',
      zIndex: 99999999999,
      anchor: 'body',
      append: 'after',
      css: `
      html{
        z-index: 99999999999 !important;
      }
    `,
      onMount: container => {
        container.style.position = 'fixed'
        container.style.visibility = 'visible'
        const app = createApp(CollectPopup, {
          browser
        })
        app.mount(container)
        return app
      },
      onRemove: app => {
        app?.unmount()
      }
    })

    collectUI.mount()

    // Register the probe as soon as the collector can receive commands. The sidebar may
    // still be initializing, and SPA navigations need a reply without remounting this UI.
    const onReadyProbe = (message: unknown, _sender: Browser.runtime.MessageSender, sendResponse: (response: { ready: boolean }) => void) => {
      if ((message as { action?: string } | null)?.action !== MessageTypeAction.ContentScriptReady) return false
      sendResponse({ ready: true })
      return false
    }
    browser.runtime.onMessage.addListener(onReadyProbe)
    ctx.onInvalidated(() => browser.runtime.onMessage.removeListener(onReadyProbe))

    const panelUI = await createShadowRootUi(ctx, {
      name: 'slax-reader-panel',
      position: 'overlay',
      alignment: 'top-left',
      zIndex: 99999999999,
      anchor: 'body',
      append: 'before',
      css: `
      html{
        z-index: 99999999999 !important;
      }

      @media print {
        :host, html {
          display: none !important;
        }
      }
    `,
      onMount: container => {
        try {
          analytics.autoTrack(container)
        } catch (e) {}

        const app = createApp(SidePanel, {
          browser
        })
        app.mount(container)
        return app
      },
      onRemove: app => {
        app?.unmount()
      }
    })

    panelUI.mount()

    watchPinnedStatus(panelUI.shadowHost)

    void browser.runtime.sendMessage({ action: MessageTypeAction.ContentScriptReady }).catch(error => {
      console.warn('[collect] failed to announce readiness:', error)
    })
  }
})
