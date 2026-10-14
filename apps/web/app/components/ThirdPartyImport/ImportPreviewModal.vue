<!-- Pre-import confirmation: file name, counts, first rows, start / cancel. A modal, not an inline block -->
<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="!busy && emit('close')">
      <div class="modal-content" role="dialog" aria-modal="true" :aria-busy="busy">
        <div class="modal-header">
          <span class="modal-title">{{ $t('page.user.import_preview_title') }}</span>
          <button class="close-btn" type="button" :disabled="busy" @click="emit('close')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <div class="file-name">{{ fileName }}</div>

          <label v-if="sourceType === 'readwise'" class="feed-option">
            <input v-model="includeFeed" type="checkbox" :disabled="busy" />
            {{ $t('page.user.import_include_feed') }}
          </label>

          <p v-if="errorText" class="preview-error" role="alert">{{ errorText }}</p>

          <div v-else-if="preview" class="preview" role="status">
            <p class="preview-counts">
              {{
                $t('page.user.import_preview_counts', {
                  eligible: preview.eligible_count,
                  feeds: preview.excluded_feed_count,
                  duplicates: preview.duplicate_count,
                  invalid: preview.invalid_row_count
                })
              }}
            </p>
            <p v-if="preview.invalid_date_count" class="preview-warning">{{ $t('page.user.import_date_warning', { count: preview.invalid_date_count }) }}</p>
            <ol class="preview-list">
              <li v-for="item in preview.preview" :key="item.target_url">
                <strong>{{ item.target_title || item.target_url }}</strong>
                <div class="preview-url">{{ item.target_url }}</div>
              </li>
            </ol>
          </div>

          <div v-else class="loading-container">
            <div class="i-svg-spinners:90-ring w-28px" style="color: var(--slax-accent)"></div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn ghost" type="button" :disabled="busy" @click="emit('close')">{{ $t('page.user.import_cancel') }}</button>
          <button class="btn primary" type="button" :disabled="busy || !preview?.eligible_count" @click="emit('start')">{{ $t('page.user.import_start') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
export interface ImportPreview {
  eligible_count: number
  excluded_feed_count: number
  duplicate_count: number
  invalid_row_count: number
  invalid_date_count: number
  preview: { target_url: string; target_title: string }[]
}

defineProps<{
  fileName: string
  sourceType: string
  preview?: ImportPreview
  busy: boolean
  errorText: string
}>()

const includeFeed = defineModel<boolean>('includeFeed', { default: false })

const emit = defineEmits<{
  start: []
  close: []
}>()

const isLocked = useScrollLock(window)

onMounted(() => {
  isLocked.value = true
})

onUnmounted(() => {
  isLocked.value = false
})
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
  width: 560px;
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

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
  }
}

.modal-body {
  flex: 1;
  overflow: auto;
  padding: 20px 24px;
  overflow-wrap: anywhere;
}

.file-name {
  font-weight: 600;
  color: var(--slax-text);
  font-size: var(--slax-fs-card);
  line-height: 1.4;
}

.feed-option {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  font-size: var(--slax-fs-aux);
  color: var(--slax-text);
  cursor: pointer;

  input {
    accent-color: var(--slax-accent);
  }
}

.preview-counts {
  margin: 12px 0 0;
  font-size: var(--slax-fs-aux);
  color: var(--slax-text-muted);
  line-height: 1.6;
}

.preview-warning {
  margin: 6px 0 0;
  font-size: var(--slax-fs-aux);
  color: var(--slax-accent);
}

.preview-error {
  margin: 12px 0 0;
  font-size: var(--slax-fs-aux);
  color: var(--slax-danger);
  line-height: 1.6;
}

.preview-list {
  margin: 12px 0 0;
  padding-left: 20px;

  li {
    margin: 8px 0;
    font-size: var(--slax-fs-aux);
    color: var(--slax-text);
    line-height: 1.5;
  }

  .preview-url {
    font-size: var(--slax-fs-tag);
    color: var(--slax-text-light);
  }
}

.loading-container {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--slax-border);
  flex-shrink: 0;
}

.btn {
  padding: 8px 18px;
  border-radius: var(--slax-radius-sm);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition:
    opacity var(--slax-dur-normal),
    background var(--slax-dur-normal);

  &.ghost {
    background: transparent;
    border: 1px solid var(--slax-border);
    color: var(--slax-text);

    &:hover:not(:disabled) {
      background: var(--slax-surface);
    }
  }

  &.primary {
    background: var(--slax-accent);
    border: 1px solid var(--slax-accent);
    color: var(--slax-btn-text);

    &:hover:not(:disabled) {
      opacity: 0.9;
    }
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
}
</style>
