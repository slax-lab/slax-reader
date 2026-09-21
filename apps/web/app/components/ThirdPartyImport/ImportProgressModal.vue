<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="$emit('close')">
      <div class="modal-content">
        <div class="modal-header">
          <span class="modal-title">{{ $t('page.user.import_progress') }}</span>
          <button class="close-btn" @click="$emit('close')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div class="progress-table" v-if="loaded || !isLoading">
          <div class="header-container">
            <div class="header table-row">
              <div class="platform">{{ $t('page.user.platform') }}</div>
              <div class="status">{{ $t('page.user.status') }}</div>
              <div class="count">{{ $t('page.user.url_count') }}</div>
              <div class="success">{{ $t('page.user.success') }}</div>
              <div class="failed">{{ $t('page.user.failed') }}</div>
              <div class="time">{{ $t('page.user.import_time') }}</div>
            </div>
          </div>
          <div class="table-body">
            <div v-for="item in progressData" :key="item.id" class="table-row">
              <div class="platform">
                <img v-if="getPlatformIcon(item.type)" :src="getPlatformIcon(item.type)" :alt="item.type" />
                <span>{{ item.type === 'readwise' ? 'Readwise Reader' : item.type === 'pinboard' ? 'Pinboard' : item.type === 'instapaper' ? 'Instapaper' : item.type }}</span>
              </div>
              <div class="status">
                <span :class="getStatusClass(item.status)">{{ getStatusText(item) }}</span>
                <div v-if="item.status === 1" class="progress-bar" role="progressbar" :aria-valuenow="importProgressPercent(item)" aria-valuemin="0" aria-valuemax="100">
                  <i :style="{ width: `${importProgressPercent(item)}%` }"></i>
                </div>
              </div>
              <div class="count">{{ item.count }}</div>
              <div class="success">
                <span class="success-count">{{ item.success_total || 0 }}</span>
              </div>
              <div class="failed">
                <span class="failed-count" :class="{ clickable: item.failed_total > 0 }" @click="handleFailureClick(item)">
                  {{ item.failed_total || 0 }}
                </span>
              </div>
              <div class="time">{{ formatDate(item.created_at) }}</div>
            </div>
          </div>
        </div>
        <div class="loading-container" v-else>
          <div class="i-svg-spinners:90-ring w-28px" style="color: var(--slax-accent)"></div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 导入失败列表Modal -->
  <ImportFailuresModal v-if="showFailuresModal" :importId="selectedImportId" @close="closeFailuresModal" />
</template>

<script setup lang="ts">
import ImportFailuresModal from '~/components/ThirdPartyImport/ImportFailuresModal.vue'

import type { ImportProcessResp } from '@commons/types/interface'
import Toast, { ToastType } from '~/components/Toast'
import { importProgressPercent, useImportTasks } from '~/composables/useImportTasks'

const { t } = useI18n()

// While the modal is open, processing rows refresh on their own. The list is shared with the
// settings section, so a modal opened after the page loaded shows rows at once; the spinner only
// shows while a load is in flight with nothing cached, and later polls swap numbers in place.
const IMPORT_POLL_MS = 5000
const { tasks: progressData, loaded, loading: isLoading, refresh, startPolling, stopPolling } = useImportTasks()
const showFailuresModal = ref(false)
const selectedImportId = ref(0)

const isLocked = useScrollLock(window)

onMounted(() => {
  isLocked.value = true
})

onUnmounted(() => {
  isLocked.value = false
  stopPolling()
})

const getImportProgressData = async () => {
  const ok = await refresh()
  if (!ok) {
    // Cached rows (if any) stay on screen, but say the refresh failed and keep trying while something is processing
    Toast.showToast({
      text: t('page.user.import_network_error'),
      type: ToastType.Error
    })
  }
  startPolling(IMPORT_POLL_MS)
}

const getPlatformIcon = (platform: string) => {
  switch (platform) {
    case 'omnivore':
      return new URL('@images/import-three-party-logo-omnivore.png', import.meta.url).toString()
    case 'pocket':
      return new URL('@images/import-three-party-logo-pocket.png', import.meta.url).toString()
    default:
      return ''
  }
}

const getStatusText = (item: ImportProcessResp) => {
  const statusMap = {
    0: t('page.user.import_status_pending'),
    1: t('page.user.import_status_processing'),
    2: t('page.user.import_status_failed'),
    3: t('page.user.import_status_complete')
  }

  const baseStatus = statusMap[item.status as keyof typeof statusMap] || t('page.user.import_status_unknown')

  // 如果是处理中状态，显示百分比
  if (item.status === 1 && item.batch_count > 0) {
    return t('page.user.import_status_processing_percent', { percentage: importProgressPercent(item) })
  }

  return baseStatus
}

const getStatusClass = (status: number) => {
  return {
    'status-complete': status === 3,
    'status-pending': status === 0,
    'status-failed': status === 2,
    'status-processing': status === 1
  }
}

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleString()
}

const handleFailureClick = (item: ImportProcessResp) => {
  selectedImportId.value = item.id
  showFailuresModal.value = true
}

const closeFailuresModal = () => {
  showFailuresModal.value = false
  selectedImportId.value = 0
}

getImportProgressData()
</script>

<style lang="scss" scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 20, 25, 0.6);
  backdrop-filter: var(--slax-blur);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.modal-content {
  background: var(--slax-surface-solid);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  box-shadow: var(--slax-shadow-modal);
  width: 800px;
  max-width: 92vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: modalSlideIn 0.3s ease-out;
}

@keyframes modalSlideIn {
  from {
    opacity: 0;
    transform: translateY(-20px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--slax-border);
  flex-shrink: 0;

  .modal-title {
    font-family: var(--slax-font-serif);
    font-size: var(--slax-fs-card);
    font-weight: 500;
    color: var(--slax-text);
    line-height: 1.4;
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: transparent;
    border: none;
    border-radius: var(--slax-radius-sm);
    color: var(--slax-text-light);
    cursor: pointer;
    transition: all var(--slax-dur-normal);

    &:hover {
      background: var(--slax-surface);
      color: var(--slax-text);
    }
  }
}

.loading-container {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 48px 24px;
}

.status .progress-bar {
  height: 4px;
  margin-top: 6px;
  border-radius: 2px;
  background: var(--slax-border);
  overflow: hidden;

  i {
    display: block;
    height: 100%;
    background: var(--slax-accent);
    transition: width var(--slax-dur-normal);
  }
}

.progress-table {
  overflow: auto;
  flex: 1;
  padding: 16px;

  .table-row {
    display: grid;
    align-items: center;
    padding: 10px 12px;
    border-radius: var(--slax-radius-sm);
    gap: 12px;
    grid-template-columns: 140px 130px 70px 90px 70px 120px;
    min-width: 620px;
    border: 1px solid transparent;

    &.header {
      font-size: var(--slax-fs-aux);
      color: var(--slax-text-muted);
      font-weight: 500;
      background: var(--slax-surface);
      margin-bottom: 4px;
    }

    &:not(.header) {
      font-size: var(--slax-fs-aux);
      color: var(--slax-text);
      transition: background var(--slax-dur-normal);
      margin-bottom: 6px;

      &:hover {
        background: var(--slax-surface);
      }
    }
  }

  .header-container {
    background: var(--slax-surface-solid);
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .platform {
    display: flex;
    align-items: center;
    gap: 10px;

    img {
      width: 20px;
      height: 20px;
      object-fit: contain;
      border-radius: 4px;
    }

    span {
      font-weight: 500;
      color: var(--slax-text);
      font-size: var(--slax-fs-aux);
    }
  }

  .status {
    span {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: var(--slax-fs-tag);
      font-weight: 500;

      &.status-complete {
        background: rgba(30, 142, 62, 0.1);
        color: #1e8e3e;
      }
      &.status-pending {
        background: rgba(242, 153, 74, 0.1);
        color: #f2994a;
      }
      &.status-failed {
        background: color-mix(in srgb, var(--slax-danger) 10%, transparent);
        color: var(--slax-danger);
      }
      &.status-processing {
        background: color-mix(in srgb, var(--slax-accent) 10%, transparent);
        color: var(--slax-accent);
        animation: pulse 2s infinite;
      }
    }
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.7;
    }
  }

  .success {
    .success-count {
      color: #1e8e3e;
      font-weight: 600;
      font-size: var(--slax-fs-aux);
    }
  }

  .failed {
    .failed-count {
      color: var(--slax-danger);
      font-weight: 600;
      font-size: var(--slax-fs-aux);

      &.clickable {
        cursor: pointer;
        text-decoration: underline;
      }
    }
  }

  .count {
    text-align: center;
    font-weight: 500;
    color: var(--slax-text);
    font-size: var(--slax-fs-aux);
  }

  .time {
    color: var(--slax-text-light);
    font-size: var(--slax-fs-tag);
    font-weight: 400;
  }
}

@media (max-width: 1024px) {
  .modal-content {
    width: 95vw;
  }

  .progress-table {
    .table-row {
      grid-template-columns: 1fr 100px 60px 70px 60px 100px;
      gap: 10px;
      min-width: auto;

      .platform {
        flex-direction: column;
        gap: 6px;
        text-align: center;

        img {
          width: 18px;
          height: 18px;
        }

        span {
          font-size: 11px;
        }
      }
    }
  }
}
</style>
