<template>
  <section class="settings-card" :aria-busy="busy">
    <h2>{{ $t('page.user.export_title') }}</h2>
    <p>{{ $t('page.user.export_description') }}</p>
    <div class="export-controls">
      <label for="saved-links-export-format">{{ $t('page.user.export_format') }}</label>
      <select id="saved-links-export-format" v-model="format" :disabled="busy">
        <option value="csv">{{ $t('page.user.export_csv') }}</option>
        <option value="json">{{ $t('page.user.export_json') }}</option>
      </select>
      <button type="button" :disabled="busy" @click="startExport">{{ $t(failed ? 'page.user.export_retry' : 'page.user.export_start') }}</button>
      <button v-if="busy" type="button" @click="cancelExport">{{ $t('page.user.export_cancel') }}</button>
    </div>
    <p v-if="busy" role="status" aria-live="polite">{{ $t('page.user.export_progress', { count }) }}</p>
    <p v-else-if="message" :role="failed ? 'alert' : 'status'">{{ message }}</p>
  </section>
</template>

<script setup lang="ts">
import { bookmarkExportFilename, type BookmarkExportFormat, downloadBookmarkExport, prepareBookmarkExport } from '~/utils/bookmarkExport'

import { RESTMethodPath } from '@commons/types/const'
import type { BookmarkExportPage } from '@commons/types/interface'

const { t } = useI18n()
const format = ref<BookmarkExportFormat>('csv')
const busy = ref(false)
const failed = ref(false)
const count = ref(0)
const message = ref('')
let active: AbortController | undefined

const cancelExport = () => active?.abort()
onBeforeUnmount(cancelExport)

const startExport = async () => {
  if (busy.value) return
  busy.value = true
  failed.value = false
  count.value = 0
  message.value = ''
  const controller = new AbortController()
  active = controller
  const selectedFormat = format.value
  const startedAt = Date.now()
  const track = (event: 'bookmark_export_start' | 'bookmark_export_complete' | 'bookmark_export_failure' | 'bookmark_export_cancel') =>
    analyticsLog({ event, format: selectedFormat, item_count: count.value, duration_ms: Date.now() - startedAt })
  track('bookmark_export_start')
  try {
    const result = await prepareBookmarkExport({
      format: selectedFormat,
      signal: controller.signal,
      fetchPage: (cursor, signal) =>
        request().get<BookmarkExportPage>({
          url: RESTMethodPath.BOOKMARK_EXPORT,
          query: cursor ? { cursor } : undefined,
          signal,
          errorInterceptors: () => {}
        }),
      onProgress: value => {
        count.value = value
      }
    })
    controller.signal.throwIfAborted()
    if (result.blob) {
      downloadBookmarkExport(result.blob, bookmarkExportFilename(selectedFormat))
      message.value = t('page.user.export_complete', { count: result.count })
    } else message.value = t('page.user.export_empty')
    track('bookmark_export_complete')
  } catch {
    if (controller.signal.aborted) {
      message.value = t('page.user.export_cancelled')
      track('bookmark_export_cancel')
    } else {
      failed.value = true
      message.value = t('page.user.export_failed')
      track('bookmark_export_failure')
    }
  } finally {
    active = undefined
    busy.value = false
  }
}
</script>

<style scoped lang="scss">
.settings-card {
  background: var(--slax-surface);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  box-shadow: inset 0 1px 0 var(--slax-inset-hi);
  padding: 24px;
}
h2 {
  font-family: var(--slax-font-serif);
  --style: font-600 text-(h2 txt) line-height-33px;
}
p {
  margin-top: 8px;
  --style: text-(meta txt) line-height-22px;
}
.export-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 24px;
}
select,
button {
  color: var(--slax-txt);
  background: var(--slax-surface);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  padding: 8px 12px;
}
:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
