<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="$emit('close')">
      <div class="modal-content">
        <div class="modal-header">
          <div class="header-left">
            <span class="modal-title">{{ $t('page.import_failures.title') }}</span>
          </div>
          <button class="close-btn" @click="$emit('close')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <div class="fixed left-0 top-0 z-100 h-0px w-full flex-center">
            <Transition name="list-loading">
              <div class="h-30px w-30px translate-y-50px rounded-full bg-surface shadow-md flex-center -mt-30px" v-show="showRefreshLoading">
                <div class="i-svg-spinners:90-ring text-24px color-accent"></div>
              </div>
            </Transition>
          </div>

          <div class="import-failures-header">
            <div class="header-actions" v-if="failureItems.length > 0">
              <div class="selection-controls">
                <label class="select-all-checkbox">
                  <input type="checkbox" :checked="isAllSelected" :indeterminate="isPartialSelected" @change="toggleSelectAll" />
                  <span class="checkmark">
                    <span class="checkmark-icon">✓</span>
                  </span>
                  <span class="text">{{ $t('page.import_failures.select_all') }}</span>
                </label>
                <span class="selected-info" v-if="selectedItems.length > 0">
                  {{ $t('page.import_failures.selected_count', { count: selectedItems.length }) }}
                </span>
              </div>

              <div class="action-buttons">
                <button class="batch-delete-btn" @click="batchDelete(false)" v-if="selectedItems.length > 0">
                  <div class="i-carbon:trash-can"></div>
                  {{ $t('page.import_failures.batch_delete') }} ({{ selectedItems.length }})
                </button>
                <button class="delete-all-btn" @click="batchDelete(true)" v-if="failureItems.length > 0">
                  <div class="i-carbon:trash-can"></div>
                  {{ $t('page.import_failures.delete_all') }}
                </button>
              </div>
            </div>
          </div>

          <div class="content-area" @scroll="handleScroll">
            <div class="import-failures" v-if="showList">
              <TransitionGroup :name="loading ? '' : 'opacity'" @after-leave="transitionLeave">
                <div v-for="item in failureItems" :key="item.id" class="failure-item" @click="handleItemClick(item.id)">
                  <div class="item-checkbox">
                    <label class="checkbox-wrapper">
                      <input type="checkbox" :checked="selectedItems.includes(item.id)" @change="handleSelect(item.id, ($event.target as HTMLInputElement).checked)" @click.stop />
                      <span class="checkmark">
                        <span class="checkmark-icon">✓</span>
                      </span>
                    </label>
                  </div>
                  <div class="item-content">
                    <div class="item-title">{{ item.title || item.target_url }}</div>
                    <div class="item-meta">
                      <span class="site-name" v-if="item.site_name">{{ item.site_name }}</span>
                    </div>
                  </div>
                </div>
              </TransitionGroup>
            </div>

            <template v-if="!(isTransitioning && isDataEmpty)">
              <div class="no-data" v-if="!loading && isDataEmpty">
                <div class="empty">
                  <div class="icon"></div>
                  <span>{{ $t('page.import_failures.empty') }}</span>
                </div>
              </div>
              <div class="loading-more" v-else-if="loading && !isDataEmpty">
                <div class="i-svg-spinners:90-ring text-20px color-accent"></div>
                <span>{{ $t('page.import_failures.loading_more') }}</span>
              </div>
              <div class="bottom-status" v-else-if="!loading && ending">
                <div class="end">
                  <div class="line"></div>
                  <span class="ml-2">{{ $t('page.import_failures.no_more') }}</span>
                  <div class="line"></div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script lang="ts" setup>
import Toast from '../Toast'
import { RESTMethodPath } from '@slax-reader/contracts/const'

const props = defineProps<{
  importId: number
}>()

const emit = defineEmits<{
  close: []
}>()

const { t } = useI18n()

interface ImportFailureItem {
  id: number
  site_name: string
  title: string
  target_url: string
}

const failureItems = ref<ImportFailureItem[]>([])
const selectedItems = ref<number[]>([])
const loading = ref(false)
const ending = ref(false)
const page = ref(1)

const showRefreshLoading = ref(false)
const isTransitioning = ref(false)
const refreshInterval = ref<NodeJS.Timeout>()

const isRefreshLoading = computed(() => {
  return loading.value && page.value === 1
})

const isDataEmpty = computed(() => {
  return failureItems.value.length === 0
})

const showList = computed(() => {
  if (isTransitioning.value) return true
  return failureItems.value.length > 0
})

const isAllSelected = computed(() => {
  return failureItems.value.length > 0 && selectedItems.value.length === failureItems.value.length
})

const isPartialSelected = computed(() => {
  return selectedItems.value.length > 0 && selectedItems.value.length < failureItems.value.length
})

watch(
  () => isRefreshLoading.value,
  value => {
    if (value) {
      refreshInterval.value = setTimeout(() => {
        showRefreshLoading.value = true
      }, 250)
    } else {
      refreshInterval.value && clearTimeout(refreshInterval.value)
      showRefreshLoading.value = false
    }
  }
)

onMounted(() => {
  document.body.style.overflow = 'hidden'
  loadFailureItems()
})

onUnmounted(() => {
  document.body.style.overflow = ''
})

const loadFailureItems = async () => {
  if (loading.value || ending.value) return

  loading.value = true

  try {
    const response = await request().get<ImportFailureItem[]>({
      url: RESTMethodPath.IMPORT_FAILURE_LIST,
      query: {
        import_id: props.importId,
        page: page.value,
        limit: 20
      }
    })

    if (!response || response.length < 1) {
      ending.value = true
    } else {
      failureItems.value.push(...response)
      page.value += 1
    }
  } catch (error) {
    console.error('Failed to load import failures:', error)
    Toast.showToast({
      text: t('page.import_failures.load_error')
    })
  } finally {
    loading.value = false
  }
}

const handleScroll = (e: Event) => {
  const target = e.target as HTMLElement
  const scrollTop = target.scrollTop
  const scrollHeight = target.scrollHeight
  const clientHeight = target.clientHeight

  // 距离底部50px时加载更多
  if (scrollTop + clientHeight >= scrollHeight - 50) {
    loadFailureItems()
  }
}

const toggleSelectAll = () => {
  if (isAllSelected.value) {
    selectedItems.value = []
  } else {
    selectedItems.value = failureItems.value.map(item => item.id)
  }
}

const handleSelect = (id: number, selected: boolean) => {
  if (selected) {
    if (!selectedItems.value.includes(id)) {
      selectedItems.value.push(id)
    }
  } else {
    selectedItems.value = selectedItems.value.filter(itemId => itemId !== id)
  }
}

const handleItemClick = (id: number) => {
  const isSelected = selectedItems.value.includes(id)
  handleSelect(id, !isSelected)
}

const batchDelete = async (deleteAll: boolean) => {
  try {
    await request().post({
      url: RESTMethodPath.IMPORT_FAILURE_DELETE,
      body: {
        bookmark_ids: selectedItems.value,
        import_id: props.importId,
        delete_all: deleteAll
      }
    })

    Toast.showToast({
      text: t('page.import_failures.batch_delete_success')
    })
    emit('close')
  } catch (error) {
    console.error('Failed to batch delete import failures:', error)
    Toast.showToast({
      text: t('page.import_failures.batch_delete_error')
    })
  }
}

const transitionLeave = () => {
  isTransitioning.value = false
}
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
  --style: w-1000px max-h-90vh max-w-95vw overflow-hidden flex flex-col;
  background: var(--slax-surface-solid);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  box-shadow: var(--slax-shadow-modal);
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
  --style: flex justify-between items-center px-24px py-14px;
  border-bottom: 1px solid var(--slax-border);
  flex-shrink: 0;

  .header-left {
    --style: flex items-center gap-12px;

    .modal-title {
      --style: text-card m-0;
      font-family: var(--slax-font-serif);
      font-weight: 500;
      color: var(--slax-text);
      line-height: 1.4;
    }
  }

  .close-btn {
    --style: bg-transparent border-none cursor-pointer transition-all duration-200 w-28px h-28px flex items-center justify-center;
    border-radius: var(--slax-radius-sm);
    color: var(--slax-text-light);

    &:hover {
      background: var(--slax-surface);
      color: var(--slax-text);
    }
  }
}

.modal-body {
  --style: flex flex-col flex-1 overflow-hidden;

  .import-failures-header {
    --style: shrink-0;
    border-bottom: 1px solid var(--slax-border);

    .header-actions {
      --style: px-16px py-12px flex items-center justify-between;
      background: var(--slax-surface);
      border-top: 1px solid var(--slax-border);

      .selection-controls {
        --style: flex items-center gap-12px;

        .select-all-checkbox {
          --style: flex items-center gap-8px cursor-pointer text-14px select-none;
          color: var(--slax-text);

          input[type='checkbox'] {
            --style: sr-only;
          }

          .checkmark {
            --style: relative w-16px h-16px border-(2px solid) rounded-3px transition-all duration-200 flex items-center justify-center;
            background: var(--slax-surface-solid);
            border-color: var(--slax-border);

            .checkmark-icon {
              --style: text-10px color-accent font-bold opacity-0 transform scale-0 transition-all duration-200;
            }
          }

          input[type='checkbox']:checked + .checkmark {
            --style: border-accent;

            .checkmark-icon {
              --style: opacity-100 scale-100;
            }
          }

          input[type='checkbox']:indeterminate + .checkmark {
            --style: border-accent;

            .checkmark-icon {
              --style: opacity-100 scale-100;
            }
          }

          .text {
            --style: font-medium;
          }
        }

        .selected-info {
          --style: text-14px color-accent font-medium bg-accent-bg px-8px py-2px rounded-6px;
        }
      }

      .action-buttons {
        --style: flex items-center gap-8px;

        .batch-delete-btn {
          --style: flex items-center gap-8px px-16px py-8px rounded-6px text-14px font-medium transition-colors cursor-pointer border-none shadow-sm;
          background: var(--slax-danger);
          color: var(--slax-btn-text);

          &:hover {
            opacity: 0.9;
          }

          div {
            --style: text-16px;
          }
        }

        .delete-all-btn {
          --style: flex items-center gap-8px px-16px py-8px rounded-6px text-14px font-medium transition-colors cursor-pointer shadow-sm;
          background: var(--slax-danger-bg);
          color: var(--slax-danger);
          border: 1px solid var(--slax-danger);

          &:hover {
            opacity: 0.9;
          }

          div {
            --style: text-16px;
          }
        }
      }
    }
  }

  .content-area {
    --style: flex-1 overflow-auto p-16px;

    .import-failures {
      --style: relative;

      .failure-item {
        --style: flex items-start gap-12px p-12px border-(1px solid) rounded-8px mb-8px transition-all duration-200 cursor-pointer relative;
        border-color: var(--slax-border);

        &:hover {
          background: var(--slax-surface);
        }

        .item-checkbox {
          --style: flex-shrink-0 mt-2px;

          .checkbox-wrapper {
            --style: flex items-center cursor-pointer;

            input[type='checkbox'] {
              --style: sr-only;
            }

            .checkmark {
              --style: relative w-16px h-16px border-(2px solid) rounded-3px transition-all duration-200 flex items-center justify-center;
              background: var(--slax-surface-solid);
              border-color: var(--slax-border);

              .checkmark-icon {
                --style: text-10px color-accent font-bold opacity-0 transform scale-0 transition-all duration-200;
              }
            }

            input[type='checkbox']:checked + .checkmark {
              --style: border-accent;

              .checkmark-icon {
                --style: opacity-100 scale-100;
              }
            }
          }
        }

        .item-content {
          --style: flex-1 min-w-0;

          .item-title {
            --style: text-14px font-medium line-height-20px mb-4px;
            color: var(--slax-text);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .item-meta {
            --style: text-12px line-height-16px;
            color: var(--slax-text-muted);

            .site-name {
              --style: px-6px py-2px rounded-4px mr-8px;
              background: var(--slax-surface);
            }
          }
        }
      }
    }

    .no-data {
      --style: pb-52px text-12px select-none relative shrink-0;
      color: var(--slax-text-light);

      .empty {
        --style: relative pt-100px flex-col items-center h-full flex-center;

        .icon {
          --style: bg-contain w-60px h-75px shrink-0;
          background-image: url('@images/logo-bg-gray.png');
        }

        span {
          --style: mt-24px text-14px line-height-22px;
        }
      }
    }

    .loading-more {
      --style: flex items-center justify-center gap-8px py-16px text-14px;
      color: var(--slax-text-muted);
    }

    .bottom-status {
      --style: py-32px text-12px select-none relative shrink-0;
      color: var(--slax-text-light);

      .end {
        --style: flex-center;

        .line {
          --style: w-36px h-1px;
          background: var(--slax-border);
        }

        span {
          --style: mx-12px text-align-center;
        }
      }
    }
  }
}

.list-loading-enter-active,
.list-loading-leave-active {
  transition: transform 0.4s;
}

.list-loading-enter-from,
.list-loading-leave-to {
  --style: -translate-y-10px;
}

@media (max-width: 1024px) {
  .modal-content {
    --style: w-95vw h-90vh;
  }
}
</style>
