<template>
  <svg class="fork-artwork" width="0" height="0" aria-hidden="true" focusable="false">
    <defs>
      <g :id="ribbonId" stroke-linecap="round" stroke-linejoin="round">
        <path
          class="ribbon-face"
          d="M12.4 4.6h12.2c.7 0 1.3.3 1.8.8l3.5 3.5c.5.5.8 1.1.8 1.8v22.6a1.1 1.1 0 0 1-1.7.9l-8-5a1.8 1.8 0 0 0-2 0l-8 5a1.1 1.1 0 0 1-1.7-.9V7.7a3.1 3.1 0 0 1 3.1-3.1Z"
        />
        <path class="ribbon-fold" d="M25 4.7v4.2c0 1 .7 1.7 1.7 1.7h3.8Z" />
        <path v-if="failure" class="ribbon-ink" d="M20 14.2v5.7m0 3v.2" />
        <g v-else-if="busy" class="ribbon-progress">
          <circle class="ribbon-track" cx="20" cy="18.5" r="4.6" />
          <path class="ribbon-ink" d="M20 13.9a4.6 4.6 0 0 1 4.6 4.6" />
        </g>
        <path
          v-else
          class="ribbon-star"
          :class="{ 'is-filled': saved }"
          d="m20 12.8 1.7 3.45 3.8.55-2.75 2.68.65 3.79-3.4-1.79-3.4 1.79.65-3.79-2.75-2.68 3.8-.55Z"
        />
      </g>
    </defs>
  </svg>
  <div v-if="!showCard" class="fork-action fork-toolbar" :class="{ 'is-confirmed': confirmed }" @keydown.esc="dismissFeedback">
    <button
      ref="toolbarAction"
      v-bind="actionAttributes"
      class="fork-button"
      :class="{ 'is-saved': saved, 'is-unavailable': !ready }"
      @click="activate"
    >
      <svg v-if="busy" class="fork-spinner" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /></svg>
      <AppIcon v-else-if="saved" name="snapshot.saved" :size="16" />
      <svg v-else class="fork-glyph" viewBox="0 0 40 40" aria-hidden="true"><use :href="`#${ribbonId}`" /></svg>
      <span :key="buttonLabel" class="fork-label">{{ buttonLabel }}</span>
    </button>

    <Transition name="fork-popover" @before-leave="disableLeavingSurface">
      <div v-if="feedbackVisible" class="fork-feedback" :class="{ 'is-error': !!failure }">
        <div class="fork-summary">
          <svg class="fork-symbol" viewBox="0 0 40 40" aria-hidden="true"><use :href="`#${ribbonId}`" /></svg>
          <div class="fork-copy">
            <p :key="feedbackTitle" class="fork-title">{{ feedbackTitle }}</p>
            <p v-if="feedbackText" :key="feedbackText" class="fork-description">{{ feedbackText }}</p>
          </div>
          <button type="button" class="fork-close" :aria-label="$t('common.operate.close')" @click="dismissFeedback">
            <AppIcon name="rss.close" :size="15" />
          </button>
        </div>
        <NuxtLink v-if="confirmed" class="fork-link fork-destination" to="/bookmarks">
          {{ $t('bookmark_fork.view_bookmarks') }} <AppIcon class="fork-arrow" name="rss.back" :size="16" />
        </NuxtLink>
        <button v-if="needsStatus && pollWindowEnded" type="button" class="fork-link fork-check" @click="restartPolling">
          {{ $t('bookmark_fork.check_status') }}
        </button>
      </div>
    </Transition>
  </div>

  <Teleport v-if="mobile" to="#snapshot-fork-card">
    <Transition appear name="fork-dock" @before-leave="disableLeavingSurface">
      <div v-if="cardVisible" class="fork-dock">
        <div ref="surface" class="fork-action fork-card" :class="{ 'is-confirmed': confirmed }">
          <div class="fork-feedback" :class="{ 'is-error': !!failure }">
            <svg class="fork-symbol" viewBox="0 0 40 40" aria-hidden="true"><use :href="`#${ribbonId}`" /></svg>
            <div class="fork-copy">
              <p :key="feedbackTitle" class="fork-title">{{ feedbackTitle }}</p>
              <p v-if="feedbackText" :key="feedbackText" class="fork-description">{{ feedbackText }}</p>
              <button v-if="needsStatus && pollWindowEnded" type="button" class="fork-link" @click="restartPolling">
                {{ $t('bookmark_fork.check_status') }}
              </button>
            </div>
          </div>
          <button ref="cardAction" v-bind="actionAttributes" class="fork-button" @click="activate">
            <span :key="buttonLabel" class="fork-label">{{ buttonLabel }}</span>
            <AppIcon v-if="confirmed" class="fork-arrow" name="rss.back" :size="14" />
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
  <span class="sr-only" role="status">{{ accessibleStatus }}</span>
  <span class="sr-only" role="status">{{ mailSent ? $t('bookmark_fork.email_sent') : '' }}</span>
</template>

<script setup lang="ts">
import { useId } from 'vue'

import AppIcon from '~/components/AppIcon.vue'

import { consumeSnapshotSaveFeedback } from '~/utils/bookmarkFork'

import type { BookmarkForkMetadata } from '@slax-reader/contracts'
import { useBookmarkFork } from '~/composables/bookmark/useBookmarkFork'
import { useAccountContext } from '~/composables/useAccountContext'

const props = withDefaults(defineProps<{
  bookmarkUid: string
  viewerForkStatus?: BookmarkForkMetadata['viewer_fork_status']
  viewerForkReceipt?: BookmarkForkMetadata['viewer_fork_receipt']
  ready?: boolean
  mobile?: boolean
  panelOpen?: boolean
}>(), { ready: true })
const emit = defineEmits<{ cardHeight: [height: number] }>()
const ribbonId = useId()
const { t } = useI18n()
const account = useAccountContext()
const source = toRef(props, 'bookmarkUid')
const observation = shallowRef<BookmarkForkMetadata>()
const status = computed(() => observation.value ? observation.value.viewer_fork_status : props.viewerForkStatus)
const receipt = computed(() => observation.value ? observation.value.viewer_fork_receipt : props.viewerForkReceipt)
const { fork, pending, processing, saved, error, loginOpen, reconcile } = useBookmarkFork(source, status)
const intended = ref(false)
const resumed = ref(false)
const busy = computed(() => pending.value || processing.value || (resumed.value && status.value == null))
const confirmed = computed(() => saved.value && intended.value)
const mailSent = computed(() => confirmed.value && receipt.value === 'sent')
const failure = computed(() => busy.value || saved.value ? '' : error.value || (intended.value && status.value === 'failed' ? t('bookmark_fork.failed') : ''))
const feedbackDismissed = ref(false)
const feedbackVisible = computed(() => !feedbackDismissed.value && (busy.value || confirmed.value || !!failure.value))
const showCard = computed(() => props.mobile && props.ready && (!saved.value || confirmed.value))
const cardVisible = computed(() => showCard.value && !props.panelOpen && !loginOpen.value)
const disabled = computed(() => !props.ready || busy.value || loginOpen.value || (saved.value && !showCard.value))
const feedbackTitle = computed(() => t(
  confirmed.value ? 'bookmark_fork.saved_copy' : busy.value ? 'bookmark_fork.copying' : failure.value ? 'bookmark_fork.failed_title' : 'bookmark_fork.keep_copy'
))
const feedbackText = computed(() => {
  if (failure.value) return failure.value === t('bookmark_fork.failed') ? '' : failure.value
  if (confirmed.value) return mailSent.value ? t('bookmark_fork.email_sent') : ''
  return t(busy.value ? 'bookmark_fork.keep_reading' : 'bookmark_fork.copy_description')
})
const buttonLabel = computed(() => t(
  !props.ready ? 'bookmark_fork.checking' : confirmed.value ? (showCard.value ? 'bookmark_fork.view_bookmarks' : 'bookmark_fork.saved')
    : saved.value ? 'bookmark_fork.saved'
    : busy.value ? 'bookmark_fork.submitting'
    : failure.value ? 'bookmark_fork.retry'
    : showCard.value ? 'bookmark_fork.save_copy' : 'bookmark_fork.action'
))
const accessibleStatus = computed(() => failure.value || (busy.value || confirmed.value ? feedbackTitle.value : ''))

const surface = ref<HTMLElement>()
const toolbarAction = ref<HTMLButtonElement>()
const cardAction = ref<HTMLButtonElement>()
const actionAttributes = computed(() => ({
  type: 'button' as const,
  'data-analytics-element': 'snapshot_save_button',
  'data-analytics-source-bookmark-id': props.bookmarkUid,
  'aria-disabled': disabled.value,
  'aria-busy': busy.value
}))

// A leaving surface stays painted briefly after it yields keyboard and pointer input.
function disableLeavingSurface(element: Element) {
  element.setAttribute('inert', '')
}

const { height } = useElementSize(surface, undefined, { box: 'border-box' })
watchEffect(() => emit('cardHeight', cardVisible.value ? height.value : 0))

const visibility = useDocumentVisibility()
const pollWindowEnded = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
let controller: AbortController | undefined
let attempts = 0
let mounted = false
const awaitingReceipt = computed(() => confirmed.value && receipt.value === 'pending')
const needsStatus = computed(() => processing.value || resumed.value || awaitingReceipt.value)

function stopPolling() {
  clearTimeout(timer)
  timer = undefined
  controller?.abort()
  controller = undefined
}

function schedulePoll(delay = 1500) {
  if (!mounted || !props.ready || !needsStatus.value || visibility.value === 'hidden' || timer || controller || pollWindowEnded.value) return
  timer = setTimeout(async () => {
    timer = undefined
    const request = new AbortController()
    controller = request
    attempts++
    try {
      const { metadata } = await $fetch<{ metadata: BookmarkForkMetadata }>(`/api/content/${encodeURIComponent(props.bookmarkUid)}`, {
        query: { meta: '1' },
        signal: request.signal,
        retry: 0,
        timeout: 5000
      })
      if (!request.signal.aborted) {
        observation.value = metadata
        reconcile(metadata.viewer_fork_status)
        if (metadata.viewer_fork_status != null) resumed.value = false
      }
    } catch {
      // A metadata failure leaves the admitted copy in progress.
    } finally {
      if (request.signal.aborted) return
      controller = undefined
      if (attempts >= 20) pollWindowEnded.value = true
      schedulePoll()
    }
  }, delay)
}

function restartPolling() {
  attempts = 0
  pollWindowEnded.value = false
  schedulePoll(0)
}

watch([needsStatus, () => props.ready], ([needed, ready]) => {
  if (needed && ready) restartPolling()
  else stopPolling()
})
watch(awaitingReceipt, waiting => {
  if (waiting) restartPolling()
})
watch(visibility, visible => {
  if (visible === 'hidden') stopPolling()
  else restartPolling()
})
watch([source, () => account.context.value.generation], () => {
  stopPolling()
  observation.value = undefined
  intended.value = false
  resumed.value = false
  feedbackDismissed.value = false
  if (needsStatus.value) restartPolling()
}, { flush: 'sync' })
watch(() => props.viewerForkStatus, () => { observation.value = undefined })

watch(loginOpen, async open => {
  if (open) return
  await nextTick()
  if (!props.panelOpen && document.activeElement === document.body) (cardAction.value ?? toolbarAction.value)?.focus()
})

function dismissFeedback() {
  if (showCard.value || !feedbackVisible.value) return
  feedbackDismissed.value = true
  toolbarAction.value?.focus()
}

onMounted(() => {
  mounted = true
  const resuming = consumeSnapshotSaveFeedback(props.bookmarkUid, account.token.value)
  intended.value = resuming
  resumed.value = resuming && status.value == null
  const url = new URL(location.href)
  if (url.searchParams.get('save_failed') === '1') {
    error.value = t('bookmark_fork.retry_after_login')
    url.searchParams.delete('save_failed')
    history.replaceState(history.state, '', url)
  }
  schedulePoll()
})
onBeforeUnmount(() => {
  mounted = false
  stopPolling()
  emit('cardHeight', 0)
})

async function activate() {
  if (disabled.value) return
  if (confirmed.value) {
    await navigateTo('/bookmarks')
    return
  }
  feedbackDismissed.value = false
  if (await fork(props.bookmarkUid)) {
    intended.value = true
    restartPolling()
  }
}
</script>

<style scoped>
.fork-action {
  --fork-accent-ink: color-mix(in srgb, var(--slax-accent) 90%, var(--slax-text));
  --ribbon-line: var(--fork-accent-ink);
  --ribbon-surface: color-mix(in srgb, var(--slax-accent) 13%, var(--slax-surface-solid));
  --ribbon-corner: color-mix(in srgb, var(--slax-accent) 28%, var(--slax-surface-solid));
  position: relative;
  flex: none;
  color: var(--slax-text);
  font: var(--slax-fs-meta)/1.4 var(--slax-font-sans);
}

.fork-button {
  --fork-face: var(--fork-accent-ink);
  position: relative;
  isolation: isolate;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 44px;
  min-width: 44px;
  padding: 5px 14px;
  border: 0;
  border-radius: var(--slax-radius-sm);
  background: transparent;
  color: var(--slax-btn-text);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

/* The painted toolbar control sits inside its full-height hit target. */
.fork-button::before {
  position: absolute;
  z-index: -1;
  inset: 4px 0;
  border-radius: inherit;
  background: var(--fork-face);
  content: '';
  transition: background-color var(--slax-dur-fast);
}
.fork-button:hover:not([aria-disabled='true']) {
  --fork-face: color-mix(in srgb, var(--slax-accent) 80%, var(--slax-text));
}
.fork-button:active:not([aria-disabled='true']) {
  --fork-face: color-mix(in srgb, var(--slax-accent) 70%, var(--slax-text));
}
.fork-button[aria-disabled='true'] { cursor: default; }
.fork-button[aria-busy='true'] { cursor: progress; }
.fork-button.is-saved,
.fork-button.is-unavailable,
.fork-button[aria-busy='true'] {
  --fork-face: transparent;
  color: var(--slax-text-muted);
  font-weight: 500;
}
.fork-toolbar .fork-button {
  column-gap: 8px;
  padding-inline: 12px 16px;
}
.fork-toolbar .fork-button::before {
  inset-block: 4px;
  border: 1px solid transparent;
  box-shadow: var(--slax-shadow-sm);
}
.fork-glyph {
  width: 23px;
  height: 23px;
  flex: none;
  --ribbon-line: var(--slax-btn-text);
  --ribbon-surface: color-mix(in srgb, var(--slax-btn-text) 12%, var(--fork-face));
  --ribbon-corner: color-mix(in srgb, var(--slax-btn-text) 34%, var(--fork-face));
}
.fork-toolbar .fork-button:is(.is-saved, [aria-busy='true']) {
  --fork-face: var(--slax-accent-bg);
  color: var(--fork-accent-ink);
  font-weight: 600;
}
.fork-toolbar .fork-button:is(.is-saved, [aria-busy='true'])::before {
  border-color: var(--slax-border-strong);
  box-shadow: none;
}
.fork-toolbar .fork-button.is-unavailable::before { box-shadow: none; }
.fork-button.is-unavailable .fork-glyph {
  --ribbon-line: currentColor;
  --ribbon-surface: var(--slax-surface-solid);
  --ribbon-corner: var(--slax-accent-bg);
}
.fork-button:focus-visible,
.fork-link:focus-visible,
.fork-close:focus-visible {
  outline: 2px solid var(--slax-accent);
  outline-offset: 1px;
}

.fork-card,
.fork-toolbar .fork-feedback {
  box-sizing: border-box;
  border: 1px solid var(--slax-border-strong);
  border-radius: var(--slax-radius);
  background: var(--slax-surface-solid);
  box-shadow: var(--slax-shadow-warm);
}

.fork-toolbar .fork-feedback {
  position: absolute;
  /* Anchor below the header rule, independent of the button's 44px hit box. */
  inset-block-start: calc(50% + var(--slax-header-h-snapshot) / 2 + 14px);
  inset-inline-end: 0;
  width: min(306px, 80vw);
  padding: 0;
  overflow: clip;
}
.fork-summary {
  position: relative;
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  align-items: start;
  column-gap: 12px;
  padding: 19px 40px 19px 16px;
}
.fork-summary .fork-title {
  font-size: var(--slax-fs-body);
  line-height: 1.4;
}
.fork-summary .fork-description { margin-top: 4px; }
.fork-close {
  position: absolute;
  inset-block-start: 0;
  inset-inline-end: 0;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: var(--slax-radius-sm);
  background: transparent;
  color: var(--slax-text-muted);
  cursor: pointer;
}
.fork-close:hover { color: var(--slax-text); }
.fork-close:focus-visible { outline-offset: -4px; }
.fork-copy { min-width: 0; overflow-wrap: anywhere; }
.fork-title {
  margin: 0;
  color: var(--slax-text);
  font-size: var(--slax-fs-meta);
  font-weight: 600;
  line-height: 1.45;
}
.fork-description {
  margin: 4px 0 0;
  color: var(--slax-text-muted);
  font-size: var(--slax-fs-aux);
  line-height: 1.5;
}
.fork-label,
.fork-title,
.fork-description,
.fork-destination {
  animation: fork-content-in var(--slax-dur-fast) ease-out;
}
.fork-link {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 44px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--fork-accent-ink);
  font: inherit;
  font-size: var(--slax-fs-aux);
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}
button.fork-link { display: flex; }
.fork-toolbar :is(.fork-destination, .fork-check) {
  box-sizing: border-box;
  display: flex;
  justify-content: space-between;
  width: 100%;
  min-height: 44px;
  padding: 8px 18px;
  border-top: 1px solid var(--slax-border);
  background: var(--slax-accent-bg);
  color: var(--fork-accent-ink);
  font-size: var(--slax-fs-aux);
  text-align: start;
}
.fork-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.fork-toolbar :is(.fork-destination, .fork-check):hover { background: var(--slax-selection); }
.fork-toolbar :is(.fork-destination, .fork-check):focus-visible { outline-offset: -3px; }
.fork-arrow { flex: none; transform: rotate(180deg); }

.fork-artwork { position: absolute; pointer-events: none; }
.fork-symbol { display: block; flex: none; width: 40px; height: 40px; }
.ribbon-face,
.ribbon-fold {
  stroke: var(--ribbon-line);
  stroke-width: 1.4;
}
.ribbon-face { fill: var(--ribbon-surface); }
.ribbon-fold { fill: var(--ribbon-corner); }
.ribbon-ink,
.ribbon-track,
.ribbon-star {
  fill: none;
  stroke: var(--ribbon-mark, var(--ribbon-line));
  stroke-width: 1.65;
}
.ribbon-track { opacity: .26; }
.ribbon-progress {
  transform-box: fill-box;
  transform-origin: center;
  animation: fork-spin .85s linear infinite;
}
.ribbon-star.is-filled {
  fill: var(--ribbon-mark, var(--ribbon-line));
  transform-box: fill-box;
  transform-origin: center;
  animation: fork-confirm var(--slax-dur-normal) var(--slax-ease-spring);
}
.is-confirmed .fork-symbol {
  --ribbon-surface: var(--fork-accent-ink);
  --ribbon-corner: color-mix(in srgb, var(--slax-btn-text) 30%, var(--fork-accent-ink));
  --ribbon-mark: var(--slax-btn-text);
}
.is-error .fork-symbol {
  --ribbon-line: var(--slax-danger);
  --ribbon-surface: var(--slax-danger-bg);
  --ribbon-corner: color-mix(in srgb, var(--slax-danger) 16%, var(--slax-surface-solid));
}
.fork-spinner {
  width: 16px;
  height: 16px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
}
.fork-spinner {
  stroke-dasharray: 32 12;
  animation: fork-spin .85s linear infinite;
}
.fork-dock {
  position: relative;
  isolation: isolate;
  padding: 0 max(12px, env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
  pointer-events: none;
}
.fork-dock::before {
  position: absolute;
  z-index: -1;
  inset: calc(0px - var(--snapshot-fork-fade-reach)) 0 0;
  content: '';
  background: linear-gradient(
    to bottom,
    transparent,
    color-mix(in srgb, var(--slax-bg) 44%, transparent) calc(var(--snapshot-fork-fade-reach) * .36),
    color-mix(in srgb, var(--slax-bg) 90%, transparent) calc(var(--snapshot-fork-fade-reach) * .68),
    var(--slax-bg) var(--snapshot-fork-fade-reach)
  );
}
.fork-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  width: 100%;
  max-width: 460px;
  margin-inline: auto;
  padding: 14px;
  pointer-events: auto;
}
[inert] .fork-card { pointer-events: none; }
.fork-card .fork-feedback {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}
.fork-card .fork-description { text-wrap: balance; }
.fork-card .fork-button { flex: none; max-width: 45%; font-size: var(--slax-fs-aux); }
.fork-card.is-confirmed .fork-button {
  --fork-face: var(--slax-accent-bg);
  padding-inline: 11px;
  color: var(--fork-accent-ink);
}
.fork-card.is-confirmed .fork-button:hover {
  --fork-face: color-mix(in srgb, var(--slax-accent) 14%, var(--slax-surface-solid));
}
.fork-card .fork-button[aria-busy='true'] { --fork-face: var(--slax-accent-bg); }

.fork-popover-enter-active, .fork-popover-leave-active {
  transition: opacity var(--slax-dur-fast), transform var(--slax-dur-fast) ease-out;
}
.fork-popover-enter-from, .fork-popover-leave-to { opacity: 0; transform: translateY(-3px); }
.fork-dock-enter-active, .fork-dock-leave-active {
  transition: opacity var(--slax-dur-normal) ease-out;
}
.fork-dock-enter-active .fork-card {
  transition: transform var(--slax-dur-normal) var(--slax-ease-spring);
}
.fork-dock-leave-active .fork-card {
  transition: transform var(--slax-dur-normal) ease-in;
}
.fork-dock-enter-from, .fork-dock-leave-to { opacity: 0; }
.fork-dock-enter-from .fork-card, .fork-dock-leave-to .fork-card { transform: translateY(20px); }

@media (max-width: 480px) {
  .fork-toolbar .fork-button { padding-inline: 7px; }
  .fork-toolbar .fork-button.is-unavailable { display: none; }
}
@media (max-width: 380px) {
  .fork-card { gap: 8px; padding: 12px 10px; }
  .fork-card .fork-feedback { gap: 7px; }
  .fork-card .fork-symbol { width: 32px; height: 32px; }
  .fork-card .fork-button { padding-inline: 10px; }
  .fork-card.is-confirmed .fork-button { gap: 5px; padding-inline: 8px; }
}
[data-slax-theme='eink'] .fork-dock::before { background: none; }
[data-slax-theme='eink'] :is(.fork-dock-enter-from, .fork-dock-leave-to, .fork-popover-enter-from, .fork-popover-leave-to) {
  opacity: 1;
  transform: none;
}
[data-slax-theme='eink'] :is(.fork-dock-enter-from, .fork-dock-leave-to) .fork-card { transform: none; }
@media (prefers-reduced-motion: reduce) {
  .fork-action *,
  .fork-action *::before,
  .fork-artwork *,
  .fork-dock,
  .fork-dock .fork-card {
    animation: none !important;
    transition: none !important;
  }
  .fork-dock-enter-from, .fork-dock-leave-to,
  .fork-popover-enter-from, .fork-popover-leave-to { opacity: 1; }
  .fork-dock-enter-from .fork-card, .fork-dock-leave-to .fork-card,
  .fork-popover-enter-from, .fork-popover-leave-to { transform: none; }
}
@keyframes fork-spin { to { transform: rotate(360deg); } }
@keyframes fork-confirm {
  from { transform: scale(.82); }
  to { transform: scale(1); }
}
@keyframes fork-content-in {
  from { opacity: .55; }
  to { opacity: 1; }
}
</style>
