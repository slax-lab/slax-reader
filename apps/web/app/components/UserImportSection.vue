<template>
  <section class="settings-card">
    <div class="title">{{ $t('page.user.import_third_party_data') }}</div>
    <div class="info">
      <div class="import">
        <div class="import-description">
          <p>{{ $t('page.user.import_description') }}</p>
        </div>
        <div class="omnivore-section">
          <div class="import-buttons">
            <ClientOnly v-for="source in sources" :key="source.type">
              <NavigateStyleButton :title="source.name" @action="chooseFile(source.type)" />
            </ClientOnly>
            <ClientOnly>
              <NavigateStyleButton title="Omnivore" @action="omnivoreClick" />
            </ClientOnly>
            <ClientOnly>
              <NavigateStyleButton title="Pocket" @action="pocketClick" />
            </ClientOnly>
            <p class="import-notes">{{ `${$t('page.user.import_note1')}\n${$t('page.user.import_note2')}` }}</p>
          </div>
          <p v-if="activeCount > 0" class="import-active" role="status">
            {{ $t('page.user.import_active_summary', { count: activeCount, percentage: latestPercent }) }}
            <template v-if="!canStart"> {{ $t('page.user.import_too_many', { max: MAX_ACTIVE_IMPORT_TASKS }) }}</template>
          </p>
          <button class="inline" @click="popupImportProgress">
            <span>{{ $t('page.user.view_import_progress') }}</span>
          </button>
        </div>
        <p v-if="errorText && !showPreviewModal" role="alert">{{ errorText }}</p>
      </div>
    </div>
  </section>
  <!-- Confirm the chosen file in a modal instead of stretching the settings card -->
  <ImportPreviewModal
    v-if="showPreviewModal && selectedFile"
    v-model:include-feed="includeFeed"
    :file-name="selectedFile.name"
    :source-type="selectedType"
    :preview="preview"
    :busy="busy"
    :error-text="errorText"
    @update:include-feed="loadPreview"
    @start="startImport"
    @close="clearSelection"
  />
  <ImportProgressModal v-if="showImportProgressModal" @close="showImportProgressModal = false" />
  <ImportLoadingModal v-if="showImportLoadingModal" :progress="importProgress" :text="importText" />
</template>

<script lang="ts" setup>
import NavigateStyleButton from '~/components/NavigateStyleButton.vue'
import ImportLoadingModal from '~/components/ThirdPartyImport/ImportLoadingModal.vue'
import ImportPreviewModal, { type ImportPreview } from '~/components/ThirdPartyImport/ImportPreviewModal.vue'
import ImportProgressModal from '~/components/ThirdPartyImport/ImportProgressModal.vue'

import { RequestError } from '@commons/frontend-utils/request'

import { RESTMethodPath } from '@commons/contracts/const'
import Toast from '~/components/Toast'
import { importProgressPercent, MAX_ACTIVE_IMPORT_TASKS, useImportTasks } from '~/composables/useImportTasks'

const { t } = useI18n()

// Crawling runs in the background after the upload; the section only shows how many tasks are still going.
const IMPORT_POLL_MS = 15000
const { activeCount, activeTasks, canStart, refresh: refreshImportTasks, startPolling } = useImportTasks()
const latestPercent = computed(() => (activeTasks.value[0] ? importProgressPercent(activeTasks.value[0]) : 0))
const watchImportTasks = async () => {
  await refreshImportTasks()
  startPolling(IMPORT_POLL_MS)
}
onMounted(() => {
  void watchImportTasks()
})

const showImportProgressModal = ref(false)
const showPreviewModal = ref(false)
const showImportLoadingModal = ref(false)
const importProgress = ref(0)
const importText = ref('')
const busy = ref(false)
const selectedFile = shallowRef<File>()
const selectedType = ref('')
const includeFeed = ref(false)
const errorText = ref('')
const preview = ref<ImportPreview>()
const sources = [
  { type: 'pinboard', name: 'Pinboard', accept: '.json,.html,.htm,.xml' },
  { type: 'readwise', name: 'Readwise Reader', accept: '.csv' },
  { type: 'instapaper', name: 'Instapaper', accept: '.csv' }
]
const importPreviewPath = '/v1/bookmark/import_preview'
const maxFileBytes = 25 * 1024 * 1024
let activeInput: HTMLInputElement | undefined
onBeforeUnmount(() => activeInput?.remove())

const clearSelection = () => {
  showPreviewModal.value = false
  selectedFile.value = undefined
  selectedType.value = ''
  preview.value = undefined
  includeFeed.value = false
  errorText.value = ''
}

const fileType = (file: File) => {
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  return (
    ({ csv: 'text/csv', json: 'application/json', xml: 'application/xml', html: 'text/html', htm: 'text/html' } as Record<string, string>)[extension] ||
    file.type ||
    'application/octet-stream'
  )
}

const loadPreview = async () => {
  if (!selectedFile.value || busy.value) return
  busy.value = true
  preview.value = undefined
  errorText.value = ''
  try {
    const result = await request().uploadFile<ImportPreview>({
      url: importPreviewPath,
      query: { type: selectedType.value, file_type: fileType(selectedFile.value), include_feed: String(includeFeed.value) },
      fileContent: selectedFile.value
    })
    if (!result) throw new Error('Preview failed')
    preview.value = result
  } catch {
    errorText.value = t('page.user.import_preview_failed')
  } finally {
    busy.value = false
  }
}

const startImport = async () => {
  if (!selectedFile.value || !preview.value?.eligible_count || busy.value) return
  // The upload modal takes over; a failed upload reports below the buttons.
  showPreviewModal.value = false
  await importThirdPartyData(selectedType.value, selectedFile.value)
}

const chooseFile = (type: string) => {
  if (busy.value) return
  if (!canStart.value) {
    errorText.value = t('page.user.import_too_many', { max: MAX_ACTIVE_IMPORT_TASKS })
    return
  }
  activeInput?.remove()
  const input = document.createElement('input')
  activeInput = input
  document.body.appendChild(input)
  input.type = 'file'
  input.accept = sources.find(s => s.type === type)?.accept || '.zip'
  input.hidden = true
  input.oncancel = () => input.remove()
  input.onchange = async () => {
    const file = input.files?.[0]
    input.remove()
    if (!file) return
    clearSelection()
    if (file.size > maxFileBytes) {
      errorText.value = t('page.user.import_size_limit')
      return
    }
    const source = sources.find(s => s.type === type)
    if (source) {
      if (!source.accept.split(',').some(ext => file.name.toLowerCase().endsWith(ext))) {
        errorText.value = t('page.user.import_file_invalid', { type })
        return
      }
      selectedFile.value = file
      selectedType.value = type
      showPreviewModal.value = true
      await loadPreview()
    } else await importThirdPartyData(type, file)
  }
  input.click()
}

const importThirdPartyData = async (type: string, file?: File) => {
  if (!file || busy.value) return
  busy.value = true
  errorText.value = ''
  showImportLoadingModal.value = true
  importText.value = t('page.user.import_unzipping')
  importProgress.value = 0
  try {
    if (file.size > maxFileBytes) throw new Error('File too large')
    let metadataList: File[] | undefined = []
    if (type === 'omnivore') {
      metadataList = await unzipGetFile(file, /metadata_[0-9]+_to_[0-9]+\.json$/)
    } else if (type === 'pocket') {
      metadataList = await unzipGetFile(file, /part_[0-9]+\.csv$/)
    } else if (sources.some(s => s.type === type)) {
      metadataList = [file]
    } else {
      Toast.showToast({
        text: t('page.user.import_file_invalid', { type })
      })
      return
    }

    if (!metadataList?.length || metadataList.some(item => item.size > maxFileBytes)) {
      Toast.showToast({
        text: t('page.user.import_file_invalid', { type })
      })
      return
    }

    // One archive goes up as one request, so the merged file must stay under the single-request size limit.
    if (metadataList.length > 1) {
      if (metadataList.reduce((total, item) => total + item.size, 0) > maxFileBytes) throw new Error('File too large')
      const texts = await Promise.all(metadataList.map(item => item.text()))
      const content =
        type === 'omnivore'
          ? JSON.stringify(
              texts.flatMap(text => {
                const records: unknown = JSON.parse(text)
                if (!Array.isArray(records)) throw new Error('Invalid metadata')
                return records
              })
            )
          : texts
              .map((text, i) => {
                const clean = text.replace(/^\uFEFF/, '')
                return i === 0 ? clean.trimEnd() : clean.slice(clean.indexOf('\n') + 1).trimEnd()
              })
              .join('\n')
      metadataList = [new File([content], type === 'omnivore' ? 'metadata.json' : 'bookmarks.csv', { type: type === 'omnivore' ? 'application/json' : 'text/csv' })]
      if (metadataList[0]!.size > maxFileBytes) throw new Error('File too large')
    }

    importText.value = t('page.user.import_uploading')
    importProgress.value = 20
    const metadata = metadataList[0]!
    const result = await request().uploadFile<{ id: string }>({
      url: RESTMethodPath.IMPORT_THIRD_PARTY_DATA,
      query: {
        type,
        file_type: fileType(metadata),
        include_feed: String(includeFeed.value)
      },
      fileContent: metadata
    })
    if (!result) throw new Error('Upload failed')
    importProgress.value = 100
    // The file is stored and the task exists; the rest happens in the background.
    const count = preview.value?.eligible_count
    Toast.showToast({ text: count ? t('page.user.import_submitted', { count }) : t('page.user.import_submitted_no_count') })
    clearSelection()
    void watchImportTasks()
  } catch (error) {
    if (error instanceof RequestError && error.name === 'TOO_MANY_IMPORT_TASKS') {
      errorText.value = t('page.user.import_too_many', { max: MAX_ACTIVE_IMPORT_TASKS })
      void watchImportTasks()
    } else {
      errorText.value = t('page.user.import_upload_failed')
    }
    // The previewed selection is still here: bring the modal back with the error so Start can be retried
    if (selectedFile.value && preview.value) showPreviewModal.value = true
  } finally {
    showImportLoadingModal.value = false
    busy.value = false
  }
}

const popupImportProgress = () => {
  showImportProgressModal.value = true
}

const omnivoreClick = () => {
  chooseFile('omnivore')
}

const pocketClick = () => {
  chooseFile('pocket')
}
</script>

<style lang="scss" scoped>
.import-notes {
  font-size: 13px;
  margin: 8px 0 0;
  max-width: 520px;
  white-space: pre-line;
  opacity: 0.75;
}
.import-active {
  font-size: 13px;
  margin: 12px 0 8px;
  max-width: 520px;
  color: var(--slax-accent);
}
.settings-card {
  background: var(--slax-surface);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  box-shadow: inset 0 1px 0 var(--slax-inset-hi);
  padding: 24px;

  .title {
    font-family: var(--slax-font-serif);
    --style: font-600 text-(h2 txt) line-height-33px text-left select-none;
  }

  .info {
    .import {
      --style: mt-8px;

      .import-description {
        --style: whitespace-pre-line;

        p {
          --style: text-(meta txt) line-height-22px;
        }
      }

      .omnivore-section {
        --style: mt-24px flex justify-between items-start;

        .import-buttons {
          --style: flex flex-col gap-12px;
        }

        button.inline {
          color: var(--slax-accent);
          text-decoration-color: var(--slax-accent);
          --style: 'text-meta line-height-20px underline transition-all duration-normal hover:(scale-102) active:(scale-105)';
        }
      }
    }
  }
}
</style>
