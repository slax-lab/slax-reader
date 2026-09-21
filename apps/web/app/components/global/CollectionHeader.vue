<template>
  <div class="collection-header">
    <template v-if="!selectCollectId">
      <div class="collect-grids collect-list">
        <TransitionGroup name="opacity">
          <div class="collect-item" v-for="collect in collects" :key="collect.id">
            <div class="collect-cell" @click="selectCollect(collect)">
              <div class="left">
                <div>
                  <img class="avatar" :src="collect.avatar" />
                </div>
                <div class="collect-info">
                  <span class="name">{{ collect.display_name }}</span>
                  <button class="href" @click="e => hrefAction(e, collect)">{{ $t('component.collection_header.subscribe_url') }}{{ getSubscribeUrl(collect) }}</button>
                </div>
              </div>
              <div class="right">
                <DotsMenu :actions="getActionMenus(collect)" @action="action => menuClick(action, collect)" />
              </div>
            </div>
          </div>
        </TransitionGroup>
      </div>
      <div class="collect-grids" v-if="isCollectLoading">
        <div class="loading">
          <div class="i-svg-spinners:90-ring w-20px" style="color: var(--slax-accent)"></div>
          <span>{{ $t('component.collection_header.loading') }}</span>
        </div>
      </div>
      <div class="collect-grids empty-wrap" v-else-if="collects.length === 0">
        <div class="empty-state">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 2l10 5-10 5L2 7l10-5z" />
            <path d="M2 12l10 5 10-5" />
            <path d="M2 17l10 5 10-5" />
          </svg>
          <span>{{ $t('component.collection_header.no_collects') }}</span>
        </div>
      </div>
    </template>
    <div class="selected-collect" v-else>
      <div class="selected-collect-header">
        <button class="back-btn" type="button" @click="unselectCollect">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span>{{ $t('component.collection_header.filter_collection_title', { title: filterCollectName || '' }) }}</span>
        </button>
      </div>
    </div>
    <!-- 手动下拉刷新 -->
  </div>
</template>

<script lang="ts" setup>
import DotsMenu from '~/components/DotsMenu.vue'

import CollectionModal from '@/components/Collection/CollectionModal/index'
import type { UserSubscribeCollectionItem } from '@commons/types/interface'
import { RESTMethodPath } from '@commons/types-pro'
import Toast, { ToastType } from '~/components/Toast'

const { t } = useI18n()

const props = defineProps({
  selectCollectId: {
    type: Number,
    required: false
  },
  selectCollectName: {
    type: String,
    required: false
  }
})

const emits = defineEmits(['select-collect', 'code-update'])

const $config = useNuxtApp().$config.public

const isCollectLoading = ref(false)
const page = ref(1)
const pageSize = 20
const collects = ref<UserSubscribeCollectionItem[]>([])
const filterCollectName = ref(props.selectCollectName || '')

watch(
  () => props.selectCollectId,
  (value, oldValue) => {
    if (value !== oldValue) {
      updateSelectCollect(value || 0)
    }
  }
)

const loadUserCollects = async () => {
  if (isCollectLoading.value) {
    return
  }

  isCollectLoading.value = true
  const res = await request().get<UserSubscribeCollectionItem[]>({
    url: RESTMethodPath.COLLECT_SUBSCRIBED_LIST,
    query: {
      page: page.value,
      page_size: pageSize
    }
  })

  if (!res) {
    Toast.showToast({
      text: t('common.error.network'),
      type: ToastType.Error
    })
  } else {
    collects.value = res

    if (props.selectCollectId) {
      updateSelectCollect(props.selectCollectId)
    }
  }

  isCollectLoading.value = false
}

const menuClick = (action: { id: string; name: string }, collect: UserSubscribeCollectionItem) => {
  if (action.id === 'view_source') {
    selectCollect(collect)
  } else if (action.id === 'unsubscribe') {
    CollectionModal.showCancelCollectionModal({
      collection: {
        collection_code: collect.code,
        collection_name: collect.display_name,
        is_free: collect.type === 1,
        subscrition_end_time: collect.subscription_end_time
      },
      callback: () => {
        if (!props.selectCollectId) {
          loadUserCollects()
        }
      }
    })
  } else if (action.id === 'remove_subscribe') {
    CollectionModal.showRemoveCollectionModal({
      collection: {
        collection_code: collect.code,
        collection_name: collect.display_name
      },
      callback: () => {
        if (!props.selectCollectId) {
          loadUserCollects()
        }
      }
    })
  }
}
const updateSelectCollect = (id: number) => {
  if (id) {
    const collect = collects.value.find(collect => collect.id === id)
    filterCollectName.value = collect?.display_name || ''
    emits('code-update', collect?.code)
  } else {
    filterCollectName.value = ''
  }
}

const selectCollect = (collect: UserSubscribeCollectionItem) => {
  emits('select-collect', {
    id: collect.id,
    name: collect.display_name,
    code: collect.code
  })
}

const getSubscribeUrl = (collect: UserSubscribeCollectionItem) => {
  const baseUrl = $config.SHARE_BASE_URL
  return `${baseUrl}/c/${collect.code}`
}

const unselectCollect = () => {
  emits('select-collect', null)
}

const getActionMenus = (collect: UserSubscribeCollectionItem) => {
  const res: { id: string; name: string }[] = [
    {
      id: 'view_source',
      name: t('common.operate.view_source')
    }
  ]

  if (collect.cancelled) {
    res.push({
      id: 'remove_subscribe',
      name: t('common.operate.remove_subscribe')
    })
  } else {
    res.push({ id: 'unsubscribe', name: t('common.operate.unsubscribe') })
  }

  return res
}

const hrefAction = (event: Event, collect: UserSubscribeCollectionItem) => {
  if (event) {
    event.stopPropagation()
  }

  const url = getSubscribeUrl(collect)
  pwaOpen({
    url
  })
}

loadUserCollects()
</script>

<style lang="scss" scoped>
.collection-header {
  /* ── 合集列表区 ── */
  .collect-grids {
    --style: 'pt-24px px-28px flex flex-col not-first:(pt-12px)';
  }

  .collect-list {
    --style: 'max-md:(pb-200px)';
  }

  .collect-item {
    --style: 'not-first:(mt-12px) w-full select-none';

    .collect-cell {
      width: 100%;
      padding: 14px 16px;
      border-radius: var(--slax-radius);
      background: var(--slax-surface);
      border: 1px solid var(--slax-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      transition: all var(--slax-dur-normal);

      &:hover {
        background: var(--slax-accent-bg);
        border-color: color-mix(in srgb, var(--slax-accent) 40%, var(--slax-border));
      }

      .left {
        display: flex;
        align-items: center;
        flex: 1;
        min-width: 0;
        overflow: hidden;

        .avatar {
          width: 44px;
          height: 44px;
          object-fit: cover;
          border-radius: 50%;
          border: 1px solid var(--slax-border);
          flex-shrink: 0;
        }

        .collect-info {
          margin-left: 12px;
          min-width: 0;
          overflow: hidden;
          display: flex;
          flex-direction: column;

          .name {
            font-size: var(--slax-fs-body);
            font-weight: 500;
            color: var(--slax-text);
            line-height: 1.4;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
          }

          .href {
            margin-top: 4px;
            font-size: var(--slax-fs-tag);
            color: var(--slax-text-muted);
            line-height: 1.4;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            text-align: left;
            transition: color var(--slax-dur-normal);
            background: none;
            border: none;
            padding: 0;
            cursor: pointer;

            &:hover {
              color: var(--slax-accent);
            }
          }
        }
      }

      .right {
        --style: flex items-center shrink-0 ml-12px;
      }
    }
  }

  /* ── 加载中 ── */
  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 24px;
    gap: 12px;

    span {
      font-family: var(--slax-font-serif);
      font-size: var(--slax-fs-body);
      font-weight: 500;
      color: var(--slax-text-muted);
    }
  }

  /* ── 空态（暂无订阅收藏）── */
  .empty-wrap {
    padding-top: 48px !important;
    padding-bottom: 48px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    text-align: center;
    color: var(--slax-text-light);

    svg {
      opacity: 0.5;
    }

    span {
      font-family: var(--slax-font-serif);
      font-size: var(--slax-fs-body);
      font-weight: 500;
      color: var(--slax-text-muted);
      line-height: 1.5;
    }
  }

  /* ── 已选中合集 — 导航栏（与 TagsHeader .selected-tag-header 同款） ── */
  .selected-collect {
    --style: px-24px;

    .selected-collect-header {
      padding-bottom: 20px;
      border-bottom: 1px solid var(--slax-border);
      margin-bottom: 4px;
    }

    .back-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border: 1px solid var(--slax-border);
      border-radius: var(--slax-radius-sm);
      background: transparent;
      color: var(--slax-text-muted);
      font-size: var(--slax-fs-aux);
      font-family: inherit;
      cursor: pointer;
      transition: all var(--slax-dur-normal);
      max-width: 100%;

      &:hover {
        background: var(--slax-surface);
        color: var(--slax-text);
        border-color: color-mix(in srgb, var(--slax-accent) 30%, var(--slax-border));
      }

      svg {
        flex-shrink: 0;
      }

      span {
        font-weight: 500;
        color: var(--slax-text);
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
    }
  }
}
</style>
