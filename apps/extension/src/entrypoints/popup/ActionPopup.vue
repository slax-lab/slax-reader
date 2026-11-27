<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import NotificationText from './NotificationText.vue'
import DotLoading from '@/components/DotLoading.vue'

import { ACTION_POPUP_PORT, type ActionPopupBookmark } from '@/config/message'

import { $t, getExtensionLocale } from '@/utils/locale'
import { initializeLocaleClient } from '@/utils/localeClient'

import type { PopupNotification, PopupNotificationResult } from '@commons/frontend-types/frontend'

const locale = initializeLocaleClient()
const visible = ref(false)
const result = ref<PopupNotificationResult>({ state: 'loading' })
const opening = ref<PopupNotification>()
const working = ref(false)
const failed = ref(false)
const labMessage = ref('')
const labsUrl = `${process.env.PUBLIC_BASE_URL}/user#labs`
const bookmark = ref<ActionPopupBookmark>({ state: 'unsaved' })
const fadeSaveStatus = ref(false)
watch(() => bookmark.value.state, (state, previous) => {
  fadeSaveStatus.value = (previous === 'saving' && state === 'saved') || (previous === 'saved' && state === 'readable')
})
const saveDisabled = computed(() => working.value || bookmark.value.state === 'saving' || bookmark.value.state === 'saved')
const saveLabel = computed(() => {
  if (bookmark.value.state === 'saving') return $t('collection_in_progress')
  if (bookmark.value.state === 'saved') return $t('collection_successful')
  return $t(bookmark.value.state === 'readable' ? 'action_popup.open_bookmark' : 'action_popup.save')
})
let source: { tabId: number; url: string } | undefined
let bookmarkRead = 0
let feedbackTimer: ReturnType<typeof setTimeout> | undefined
let port: Browser.runtime.Port | undefined
let disposed = false
let reconnecting = false

const items = computed(() => result.value.state === 'ready'
  ? result.value.items.filter(item => item.kind !== opening.value?.kind || item.id !== opening.value.id)
  : [])

async function activeSource() {
  if (source) return source
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (tab?.id != null && tab.url) source = { tabId: tab.id, url: tab.url }
  return source
}

async function refreshBookmark() {
  if (disposed || working.value || feedbackTimer) return
  const version = ++bookmarkRead
  try {
    const tab = await activeSource()
    if (!tab) return
    const response = (await browser.runtime.sendMessage({ target: 'action-popup', method: 'bookmark-state', ...tab })) as { ok?: boolean; bookmark?: ActionPopupBookmark } | undefined
    if (disposed || version !== bookmarkRead || !response?.ok) return
    if (response.bookmark) bookmark.value = response.bookmark
    else if (bookmark.value.state === 'saving') bookmark.value = { state: 'unsaved' }
  } catch {
    // A temporary lookup failure shouldn't reset feedback for an accepted save.
  }
}

function connect() {
  port = browser.runtime.connect({ name: ACTION_POPUP_PORT })
  port.onMessage.addListener((message: PopupNotificationResult | { method: 'opened'; ok: boolean }) => {
    reconnecting = false
    if ('method' in message) {
      if (message.ok) window.close()
      else {
        opening.value = undefined
        failed.value = true
      }
      return
    }
    result.value = message
    if (message.state !== 'ready') opening.value = undefined
    if (message.state !== 'signed-out') void refreshBookmark()
  })
  port.onDisconnect.addListener(() => {
    port = undefined
    opening.value = undefined
    if (!disposed && !reconnecting) {
      reconnecting = true
      result.value = { state: 'loading' }
      connect()
    } else result.value = { state: 'unavailable' }
  })
}
onMounted(async () => {
  try {
    const response = (await browser.runtime.sendMessage({ target: 'action-popup', method: 'open' })) as { redirected?: boolean } | undefined
    if (response?.redirected) {
      window.close()
      return
    }
  } catch {
    // The notification port can still connect if the worker restarted during the check.
  }
  if (disposed) return
  visible.value = true
  connect()
  void refreshBookmark()
})
onUnmounted(() => {
  disposed = true
  clearTimeout(feedbackTimer)
  port?.disconnect()
  locale.dispose()
})

async function act(method: 'save' | 'open-inbox' | 'open-bookmark') {
  if (working.value) return
  working.value = true
  failed.value = false
  labMessage.value = ''
  ++bookmarkRead
  const previousBookmark = bookmark.value
  if (method === 'save') bookmark.value = { state: 'saving' }
  try {
    const message = { target: 'action-popup', method }
    const tab = method === 'open-inbox' ? undefined : await activeSource()
    const response = (await browser.runtime.sendMessage({ ...message, ...tab })) as { ok?: boolean; operation?: string; bookmark?: ActionPopupBookmark; labMessage?: string } | undefined
    if (!response?.ok) {
      bookmark.value = response?.bookmark ?? previousBookmark
      labMessage.value = response?.labMessage ?? ''
      failed.value = true
      return
    }
    if (response.bookmark) {
      bookmark.value = response.bookmark
      if (!disposed && response.bookmark.state === 'saved') {
        // Keep the acknowledgement visible when sync has already caught up.
        feedbackTimer = setTimeout(() => {
          feedbackTimer = undefined
          void refreshBookmark()
        }, 600)
      }
    } else if (response.operation) {
      const url = new URL(browser.runtime.getURL('/pdf-save.html'))
      url.searchParams.set('operation', response.operation)
      location.replace(url.href)
    } else window.close()
  } catch {
    bookmark.value = previousBookmark
    failed.value = true
  } finally {
    working.value = false
  }
}

function open(item: PopupNotification) {
  if (opening.value || !port) return
  failed.value = false
  labMessage.value = ''
  opening.value = item
  port.postMessage({
    method: 'open',
    kind: item.kind,
    id: item.id,
    ...(item.kind === 'subscription' ? { throughAt: item.throughAt } : {})
  })
}
</script>

<template>
  <main v-if="visible" class="action-popup" :lang="getExtensionLocale()">
    <button class="action action-primary" type="button" :disabled="saveDisabled" @click="act(bookmark.state === 'readable' ? 'open-bookmark' : 'save')">
      <span class="sr-only" aria-live="polite">{{ saveLabel }}</span>
      <Transition name="save-status" :mode="fadeSaveStatus ? 'out-in' : 'default'" :css="fadeSaveStatus">
        <span :key="bookmark.state" class="action-primary-content" :data-state="bookmark.state" aria-hidden="true">
          <DotLoading v-if="bookmark.state === 'saving'" class="action-loading" />
          <span v-else-if="bookmark.state === 'saved'" class="i-solar-check-circle-linear icon" />
          <span v-else-if="bookmark.state === 'readable'" class="i-solar-arrow-right-up-linear icon" />
          <span v-else class="i-solar-bookmark-linear icon" />
          <span>{{ saveLabel }}</span>
        </span>
      </Transition>
    </button>

    <section v-if="items.length" class="notifications" aria-labelledby="popup-notifications-title">
      <h1 id="popup-notifications-title" class="notifications-title">
        <span class="i-solar-bell-linear icon" aria-hidden="true" />
        {{ $t('action_popup.notifications') }}
      </h1>
      <div class="notification-card">
        <ul class="notification-list">
          <li v-for="item in items" :key="`${item.kind}:${item.id}`">
            <button type="button" class="action notification" :disabled="!!opening" @click="open(item)">
              <span class="notification-source" :class="{ 'source-subscription': item.kind === 'subscription' }" aria-hidden="true">
                <span :class="item.kind === 'save' ? 'i-solar-bookmark-square-minimalistic-linear' : 'i-solar-user-heart-linear'" class="icon" />
              </span>
              <NotificationText :item="item" />
              <span class="notification-dot" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </div>
    </section>

    <footer class="popup-footer">
      <button class="action action-inbox" type="button" :disabled="working" @click="act('open-inbox')">
        <span class="i-solar-inbox-linear icon" aria-hidden="true" />
        <span>{{ $t('action_popup.inbox') }}</span>
        <span class="i-solar-arrow-right-up-linear icon trailing" aria-hidden="true" />
      </button>
      <p v-if="failed" class="status error" role="alert">
        {{ labMessage || $t('action_popup.failed') }}
        <a v-if="labMessage" :href="labsUrl" target="_blank" rel="noopener">{{ $t('open_labs_in_settings') }}</a>
      </p>
    </footer>
  </main>
</template>

<style scoped>
/* The native bubble supplies the outer edge. Match the Web Inbox light background. */
:global(html) {
  background: #faf8f2;
}

:global(body) {
  margin: 0;
}

/* Web warm-paper roles, owned by this compact Extension action surface. */
.action-popup {
  --popup-text: #2b2520;
  --popup-text-muted: #6f665c;
  --popup-accent: #9a5233;
  --popup-accent-bg: #f1e7d9;
  --popup-border: #e9dfd3;
  --popup-danger: #a33333;
  --popup-gutter: 16px;
  --popup-row-gap: 9px;
  --popup-notification-padding: 6px;
  --popup-source-size: 26px;

  box-sizing: border-box;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  width: 320px;
  padding-block-start: var(--popup-gutter);
  color: var(--popup-text);
  font: 13px/18px Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.action-primary,
.notifications {
  margin: 0 var(--popup-gutter) 12px;
}

.action {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: var(--popup-row-gap);
  width: 100%;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.action-primary {
  width: calc(100% - 2 * var(--popup-gutter));
  min-height: 42px;
  margin-block-end: var(--popup-gutter);
  border-radius: 10px;
  color: #fff8f2;
  font-size: 14px;
  font-weight: 500;
}

.action-primary-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: inherit;
  border-radius: inherit;
  color: var(--popup-text-muted);
}

.action-primary-content[data-state='saved'] {
  color: var(--popup-accent);
}

.action-primary:not(:disabled) .action-primary-content:is([data-state='unsaved'], [data-state='readable']) {
  background: var(--popup-accent);
  color: inherit;
  font-weight: 600;
}

.popup-footer {
  border-top: 1px solid var(--popup-border);
}

.action-inbox {
  min-height: 44px;
  justify-content: center;
  gap: 14px;
  padding-inline: 15px;
  border-radius: 0;
  color: #67594d;
  font-weight: 500;
}

.action:not(.action-primary):is(:hover:not(:disabled), :focus-visible) {
  background: var(--popup-accent-bg);
}

.action-primary:is(:hover, :focus-visible):not(:disabled) .action-primary-content:is([data-state='unsaved'], [data-state='readable']) {
  background: #8a4829;
}

.action:focus-visible {
  outline: 2px solid var(--popup-accent);
  outline-offset: -2px;
}

.action-primary:focus-visible {
  outline-color: currentColor;
  outline-offset: -4px;
}

.action:disabled {
  cursor: default;
  opacity: 0.65;
}

.action-primary:disabled {
  opacity: 1;
}

.save-status-leave-active {
  transition: opacity 100ms ease-in;
}

.save-status-enter-active {
  transition: opacity 150ms ease-out;
}

.save-status-enter-from,
.save-status-leave-to {
  opacity: 0;
}

.action-loading {
  --dot-loading-color: currentColor;
}

@media (prefers-reduced-motion: reduce) {
  .save-status-leave-active,
  .save-status-enter-active {
    transition: none;
  }

  .save-status-enter-from,
  .save-status-leave-to {
    opacity: 1;
  }

  .action-loading :deep(.dot) {
    animation: none;
  }
}

.icon {
  width: 16px;
  height: 16px;
  flex: none;
}

.trailing {
  width: 12px;
  height: 12px;
  margin-inline-start: -7px;
}

.notifications-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 8px;
  padding-inline: 4px;
  color: var(--popup-text-muted);
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
}

.notifications-title .icon {
  width: 13px;
  height: 13px;
}

.notification-card {
  --popup-notification-card-padding: 4px;
  --popup-notification-text-inset: calc(var(--popup-notification-padding) + var(--popup-source-size) + var(--popup-row-gap));

  padding: var(--popup-notification-card-padding);
  border-radius: 12px;
  background: #fcf8f0;
  box-shadow: inset 0 0 0 1px var(--popup-border);
}

.notification-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  row-gap: calc(2 * var(--popup-notification-card-padding) + 1px);
  margin: 0;
  padding: 0;
  list-style: none;
}

.notification-list li + li {
  position: relative;
}

.notification-list li + li::before {
  position: absolute;
  inset-block-start: calc(-1px - var(--popup-notification-card-padding));
  inset-inline: var(--popup-notification-text-inset) 9px;
  block-size: 1px;
  background: var(--popup-border);
  opacity: 0.7;
  content: '';
}

.notification {
  min-height: 44px;
  padding-inline: var(--popup-notification-padding) 9px;
  border-radius: 8px;
}

.notification-source {
  display: grid;
  place-items: center;
  flex: none;
  width: var(--popup-source-size);
  height: var(--popup-source-size);
  border-radius: 7px;
  background: #efeae0;
  color: #6b6156;
}

.source-subscription {
  background: #fbe4d8;
  color: #b4532c;
}

.notification-dot {
  box-sizing: border-box;
  width: 7px;
  height: 7px;
  flex: none;
  border: 1px solid var(--popup-accent);
  border-radius: 50%;
  background: #F57F59;
}

.status {
  margin: 0;
  padding: 6px 15px;
  color: var(--popup-text-muted);
}

.error {
  color: var(--popup-danger);
}

.error a {
  display: block;
  color: inherit;
}
</style>
