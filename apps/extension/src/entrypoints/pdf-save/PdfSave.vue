<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import CollectFeedback from '@/components/CollectFeedback.vue'
import { request } from '@/bridge/request'
import { getCurrentSessionToken } from '@/utils/session'
import { initializeLocaleClient } from '@/utils/localeClient'
import { $t, getExtensionLocale } from '@/utils/locale'
import { pdfBasename, readLocalPdf, readPdfTitle } from '@/utils/pdfFile'
import { pdfMetadataTitle, type PdfUploadResult } from '@slax-reader/contracts/pdf'

type State = 'ready' | 'preparing' | 'reading' | 'uploading' | 'saved' | 'queued' | 'permission' | 'labs' | 'login' | 'source' | 'unsupported' | 'size' | 'invalid' | 'read' | 'failed' | 'cancelled' | 'injection'
const state = ref<State>('preparing')
const source = ref('')
const name = ref('')
const busy = ref(false)
const uid = ref('')
let operation = new URL(location.href).searchParams.get('operation') || ''
const inline = new URL(location.href).searchParams.get('surface') === 'inline'
const owner = crypto.randomUUID()
const locale = initializeLocaleClient()
const local = computed(() => source.value.startsWith('file:'))
const supported = computed(() => /^(https?:\/\/|file:)/.test(source.value))
let controller: AbortController | undefined
let session: string | null = null
let disposed = false
let validating = false
let closeTimer: ReturnType<typeof setTimeout> | undefined
let checksInterrupted: 'cancelled' | 'login' | undefined
const message = async (method: string, extra: Record<string, unknown> = {}) => {
  const result = await browser.runtime.sendMessage({ target: 'pdf-save', operation, owner, method, ...extra })
  if (!result?.ok) throw new Error('source')
  return result as { sourceUrl: string; state: string; autoStart: boolean; surface: 'inline' | 'action' }
}
const checkSession = async () => {
  const current = await getCurrentSessionToken()
  if (!session || !current || session !== current) throw new Error('login')
  return current
}
const fail = (error: unknown) => {
  const reason = controller?.signal.reason
  const code = reason instanceof Error && ['source', 'login'].includes(reason.message) ? reason.message : error instanceof Error ? error.message : ''
  const errorName = error instanceof Error ? error.name : ''
  state.value = code === 'source' ? 'source' : !session || code === 'Not login' || code === 'login' ? 'login' : reason instanceof Error && reason.message === 'timeout' ? 'failed' : controller?.signal.aborted ? 'cancelled' : errorName === 'LAB_FEATURE_DISABLED' ? 'labs' :
    ['source', 'login', 'size', 'invalid', 'read', 'permission'].includes(code) ? code as State : 'failed'
}
const checks = async (automatic = false) => {
  let startSave = false
  if (busy.value) return
  checksInterrupted = undefined
  const explicitRetry = ['failed', 'cancelled'].includes(state.value)
  busy.value = true
  state.value = 'preparing'
  try {
    const result = await message('claim')
    source.value = result.sourceUrl
    if (!supported.value) { state.value = 'unsupported'; return }
    if (result.surface === 'action' && !local.value && /^https?:/.test(source.value)) { state.value = 'injection'; return }
    name.value = local.value ? pdfBasename(source.value, true).replace(/\.pdf$/i, '') : new URL(source.value).hostname
    if (local.value && !(await browser.extension.isAllowedFileSchemeAccess())) { state.value = 'permission'; return }
    session = await getCurrentSessionToken()
    if (!session) throw new Error('login')
    if (result.state === 'saved' || result.state === 'queued') { state.value = result.state; return }
    if (result.state === 'submitted') {
      if (!explicitRetry) { state.value = 'failed'; return }
      await message('retry')
    }
    if (automatic && !result.autoStart) { state.value = 'failed'; return }
    state.value = 'ready'
    startSave = true
  } catch (error) { fail(error) }
  finally {
    busy.value = false
    if (checksInterrupted) state.value = checksInterrupted
  }
  if (startSave && !disposed && !checksInterrupted) await save()
}
const save = async () => {
  if (busy.value || !supported.value) return
  busy.value = true
  controller = new AbortController()
  const signal = controller.signal
  const timeout = setTimeout(() => controller?.abort(new Error('timeout')), 120_000)
  let file: File | undefined
  try {
    await message('begin')
    await checkSession()
    if (local.value) {
      state.value = 'preparing'
      if (!(await browser.extension.isAllowedFileSchemeAccess())) { state.value = 'permission'; return }
      const labs = await request.get<{ features: { key: string; enabled: boolean }[] }>({ url: '/v1/user/labs', signal })
      if (!labs?.features?.some(item => item.key === 'pdf' && item.enabled === true)) { state.value = 'labs'; return }
      state.value = 'reading'
      file = await readLocalPdf(source.value, signal)
      name.value = await readPdfTitle(file, signal) || file.name.replace(/\.pdf$/i, '')
    }
    await message('check')
    const token = await checkSession()
    signal.throwIfAborted()
    await message('submit')
    signal.throwIfAborted()
    const headers = { Authorization: `Bearer ${token}` }
    state.value = 'uploading'
    if (file) {
      const result = await request.post<PdfUploadResult>({
        url: `/v1/bookmark/upload_pdf?filename=${encodeURIComponent(file.name)}`, body: file,
        headers: { ...headers, 'Content-Type': 'application/pdf' }, signal
      })
      if (typeof result?.bookmark_id !== 'number' || !Number.isFinite(result.bookmark_id) || result.bookmark_id <= 0 || typeof result.bookmark_uid !== 'string' || !result.bookmark_uid.trim()) throw new Error('failed')
      uid.value = result.bookmark_uid
      name.value = pdfMetadataTitle(undefined, result.title) || name.value
      state.value = 'saved'
    } else {
      const result = await request.post<{ bmId: string }>({ url: '/v1/bookmark/add_url', body: { target_url: source.value }, headers, signal })
      if (typeof result?.bmId !== 'string') throw new Error('failed')
      state.value = 'queued'
    }
    // The backend acknowledgement is authoritative. Background synchronization
    // must not turn a confirmed save into an uncertain request or replay it.
    const result = state.value
    await checkSession().catch(() => { uid.value = ''; state.value = 'login' })
    await message('complete', { result }).catch(() => {})
  } catch (error) { fail(error) }
  finally {
    file = undefined
    clearTimeout(timeout)
    await message('release').catch(() => {})
    controller = undefined
    busy.value = false
  }
}
const cancel = () => { checksInterrupted = 'cancelled'; controller?.abort(); state.value = 'cancelled' }
const open = (path: string) => browser.tabs.create({ url: `${process.env.PUBLIC_BASE_URL}${path}` })
const settings = () => browser.tabs.create({ url: `${navigator.userAgent.includes('Edg/') ? 'edge' : 'chrome'}://extensions/?id=${browser.runtime.id}` })
const cookieChanged = (change: { cookie: { name: string; domain: string } }) => {
  const domain = (process.env.COOKIE_DOMAIN || new URL(process.env.PUBLIC_BASE_URL || '').hostname).replace(/^\./, '')
  if (change.cookie.name === process.env.COOKIE_TOKEN_NAME && change.cookie.domain.replace(/^\./, '') === domain) {
    checksInterrupted = 'login'
    controller?.abort(new Error('login'))
    session = null
    state.value = 'login'
  }
}
const interval = setInterval(async () => {
  if (disposed || validating || !busy.value || !controller) return
  validating = true
  try { await message('check'); await checkSession() } catch (error) { controller?.abort(error) }
  finally { validating = false }
}, 500)
const start = async () => {
  try {
    if (!operation) {
      const result = await browser.runtime.sendMessage({ target: 'pdf-save', method: 'initialize' })
      if (!result?.ok) throw new Error('source')
      if (result.inline) { window.close(); return }
      operation = result.operation
    }
    if (inline) {
      const identity = await message('identify') as unknown as { bound: boolean; frameId: number; token: string }
      if (!identity.bound) {
        window.parent.postMessage({ type: 'slax-pdf-frame-ready', operation, frameId: identity.frameId, token: identity.token }, '*')
        let bound = false
        for (let count = 0; count < 40 && !disposed; count++) {
          const result = await browser.runtime.sendMessage({ target: 'pdf-save', operation, owner, method: 'bound' })
          if (result?.ok) { bound = true; break }
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        if (!bound) throw new Error('source')
      }
    }
    await checks(true)
  } catch (error) { fail(error) }
}
onMounted(() => { browser.cookies.onChanged.addListener(cookieChanged); void start() })
onUnmounted(() => {
  disposed = true
  controller?.abort()
  clearInterval(interval)
  clearTimeout(closeTimer)
  browser.cookies.onChanged.removeListener(cookieChanged)
  locale.dispose()
})
const close = () => {
  controller?.abort()
  if (inline) void message('close').catch(() => {})
  else window.close()
}
const resizePopup = async () => {
  await nextTick()
  if (inline && operation && !disposed) await message('resize', { height: document.body.scrollHeight }).catch(() => {})
}
watch([state, busy], () => { void resizePopup() })
watch(state, value => {
  clearTimeout(closeTimer)
  if (inline && (value === 'saved' || value === 'queued')) closeTimer = setTimeout(close, 2000)
})
</script>

<template>
  <main :lang="getExtensionLocale()" :class="{ 'native-action': !inline }">
    <CollectFeedback :title="name || $t('pdf_save.title')"
      :class="{ 'permission-feedback': state === 'permission' }"
      :status="state === 'permission' ? $t('pdf_save.permission_label') : $t(`pdf_save.${state}`)"
      :loading="busy" :success="state === 'saved' || state === 'queued'"
      :close-label="$t('pdf_save.close')" expanded standalone @close="close">
      <template v-if="state === 'permission'" #title>
        <h1>{{ $t('pdf_save.permission_title') }}</h1>
      </template>
      <div v-if="state === 'permission'" class="permission-guide">
        <ol>
          <li>{{ $t('pdf_save.permission_step_settings') }}</li>
          <li>
            <span>{{ $t('pdf_save.permission_step_toggle') }}</span>
            <div class="switch-demo" role="img" :aria-label="$t('pdf_save.permission_image')">
              <span class="switch-demo-label" aria-hidden="true">{{ $t('pdf_save.permission_toggle_label') }}</span>
              <span class="switch-demo-track" aria-hidden="true"><span class="switch-demo-thumb"></span></span>
            </div>
          </li>
          <li>{{ $t('pdf_save.permission_step_return') }}</li>
        </ol>
      </div>
      <div class="actions" :class="{ 'permission-actions': state === 'permission' }">
        <button v-if="state === 'permission'" class="primary-action" @click="settings">{{ $t('pdf_save.settings') }}</button>
        <button v-if="busy" @click="cancel">{{ $t('pdf_save.cancel') }}</button>
        <button v-if="!busy && !['saved', 'queued', 'unsupported', 'source'].includes(state)" @click="checks()">{{ state === 'permission' ? $t('pdf_save.permission_retry') : $t('pdf_save.retry') }}</button>
        <button v-if="state === 'login'" @click="open('/login?from=extension')">{{ $t('pdf_save.sign_in') }}</button>
        <button v-if="['saved', 'queued', 'failed'].includes(state)" @click="open('/bookmarks')">{{ $t('pdf_save.list') }}</button>
        <button v-if="uid && state === 'saved'" @click="open(`/b/${encodeURIComponent(uid)}`)">{{ $t('pdf_save.open') }}</button>
      </div>
    </CollectFeedback>
  </main>
</template>

<style>
:root { color-scheme: light; font: 14px/1.5 PingFang SC, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
button { font-family: inherit; }
body { margin: 0; }
body:has(main.native-action) { width: 340px; }
main { width: 100%; }
.actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 16px; }
.actions:empty { display: none; }
.actions button {
  font: inherit; font-size: 13px; line-height: 18px; background: transparent; border: 0; padding: 4px 0; min-height: 32px;
  color: var(--collect-accent); cursor: pointer; transition: opacity 250ms ease-in-out;
}
.actions button:hover { opacity: 0.8; }
.actions button:active { opacity: 0.6; }
.actions button:focus-visible { outline: 2px solid var(--collect-accent); outline-offset: 3px; }
/* Close control: CollectFeedback draws a 16px icon with a 16px hit area. Grow the hit area to 32px with padding and
   negative margins so the icon and header layout stay where they were. Scoped here so Collect.vue is unchanged. */
main > .slax-popup.standalone .header button { box-sizing: content-box; padding: 8px; margin: -7px -8px -9px -8px; }
/* PDF save feedback reuses the collection popup's type scale (see Collect.vue). Muted and accent text are darkened
   for every state of this surface to reach 4.5:1 on white at 13px; the page-save popup in Collect.vue keeps its
   original palette (DESIGN.md section 4.3). */
/* `.standalone` raises specificity above CollectFeedback's scoped `.slax-popup[data-v-*]` variable block. */
main .slax-popup.standalone { --collect-muted: #666; --collect-accent: #33709f; }
main .slax-popup.standalone.permission-feedback { --collect-tint: #f5f5f5; }
.permission-feedback h1 { margin: 0; font: inherit; font-size: 16px; font-weight: bold; line-height: 24px; }
.permission-guide ol { list-style: none; padding: 0; margin: 12px 0 0; counter-reset: setup; display: grid; gap: 12px; }
.permission-guide li { counter-increment: setup; display: grid; grid-template-columns: 22px 1fr; gap: 6px 10px; align-items: start; font-size: 13px; line-height: 22px; color: var(--collect-text); overflow-wrap: anywhere; }
.permission-guide li::before { content: counter(setup); display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--collect-tint); color: var(--collect-text); font-size: 12px; font-weight: 500; }
.permission-guide .switch-demo { grid-column: 2; }
/* DESIGN EXCEPTION (DESIGN.md section 9, third-party surface): this row imitates Chrome's own "Allow access to
   file URLs" setting in its on state so users can recognise it. Its blue and shape intentionally follow Chrome,
   not the Extension palette, and must not be reused for Extension controls. */
.switch-demo {
  --chrome-switch-on: #0b57d0;
  display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; padding: 0 12px;
  border: 1px solid var(--collect-border); border-radius: 8px; background: var(--collect-surface);
}
.switch-demo-label { font-size: 13px; line-height: 18px; color: var(--collect-text); overflow-wrap: anywhere; }
.switch-demo-track { position: relative; flex: none; width: 36px; height: 20px; border-radius: 10px; background: var(--chrome-switch-on); }
.switch-demo-thumb { position: absolute; top: 3px; right: 3px; width: 14px; height: 14px; border-radius: 50%; background: #fff; }
.permission-actions { display: flex; flex-direction: column; align-items: flex-start; gap: 0; margin-top: 12px; }
.permission-actions button { padding: 0; color: var(--collect-muted); }
.permission-actions .primary-action { color: var(--collect-accent); font-weight: 600; }
@media (prefers-reduced-motion: reduce) { .actions button { transition: none; } }
</style>
