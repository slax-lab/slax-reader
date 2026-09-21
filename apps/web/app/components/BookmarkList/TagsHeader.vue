<template>
  <div class="tags-header">
    <!-- 浏览态：新建 + 我的标签 / 自动标签 + 未打标签入口 -->
    <template v-if="!isFiltering">
      <!-- 添加标签行 -->
      <div class="tags-add-row">
        <div class="tag-add" v-if="!isAddingTag" @click="addTagClick">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>{{ t('component.tags_header.add_tag') }}</span>
        </div>
        <div class="tag-input-wrap" v-else>
          <input
            v-autofocus
            v-ime-guard
            type="text"
            :disabled="isAddingTagLoading"
            v-model="addingTagName"
            :placeholder="t('component.tags_header.add_tag_placeholder')"
            v-on-key-stroke:Escape,Enter="[onKeyDown, { eventName: 'keydown' }]"
          />
          <button v-if="!isAddingTagLoading" @click="saveTag" class="tag-input-confirm">
            {{ t('common.operate.add') }}
          </button>
          <div class="i-svg-spinners:90-ring w-16px" style="color: var(--slax-accent)" v-else></div>
        </div>
      </div>

      <!-- 加载中 -->
      <div class="tags-loading" v-if="isTagLoading">
        <div class="i-svg-spinners:90-ring w-16px" style="color: var(--slax-accent)"></div>
        <span>{{ $t('component.tags_header.loading') }}</span>
      </div>

      <template v-if="tags.length">
        <!-- 我的标签；一个都没有时用引导块代替 -->
        <TagSection
          class="mine"
          :title="t('component.tags_header.mine')"
          :hint="t('component.tags_header.mine_hint')"
          :tags="mineTags"
          editable
          @select="selectTag"
          @edit="editTagClick"
        >
          <template #empty>
            <div class="mine-onboarding">
              <div class="mine-onboarding-title">{{ t('component.tags_header.empty_mine') }}</div>
              <p class="mine-onboarding-desc">{{ t('component.tags_header.empty_mine_desc') }}</p>
              <!-- 改用 v-if div 包裹 v-for，避开 LF 异步列表的 patch 崩溃 -->
              <div class="mine-onboarding-chips" v-if="onboardingTags.length">
                <TagChip v-for="tag in onboardingTags" :key="tag.id" :tag="tag" @click="promoteTag" />
              </div>
            </div>
          </template>
        </TagSection>

        <!-- 自动标签 -->
        <TagSection
          v-if="autoTags.length"
          class="auto"
          :title="t('component.tags_header.auto')"
          :tags="autoTags"
          promotable
          editable
          @select="selectTag"
          @promote="promoteTag"
          @edit="editTagClick"
        />

        <!-- 未打标签的文章 -->
        <button class="tag-untagged" type="button" @click="emits('select-untagged')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.59 13.41 11 3.83V3H4v7h.83l9.58 9.59a2 2 0 0 0 2.82 0l3.36-3.36a2 2 0 0 0 0-2.82Z" />
            <circle cx="7.5" cy="6.5" r="1" />
          </svg>
          <span>{{ t('component.tags_header.untagged') }}</span>
        </button>
      </template>

      <BookmarksEmptyView
        v-if="!isTagLoading && tags.length === 0"
        class="tags-empty"
        :title="$t('page.bookmarks_index.empty_topics_title')"
        :desc="$t('page.bookmarks_index.empty_topics_desc')"
      >
        <template #icon>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.59 13.41 11 3.83V3H4v7h.83l9.58 9.59a2 2 0 0 0 2.82 0l3.36-3.36a2 2 0 0 0 0-2.82Z" />
            <circle cx="7.5" cy="6.5" r="1" />
          </svg>
        </template>
      </BookmarksEmptyView>
    </template>

    <!-- 筛选态：返回 + 已选标签（交集）+ “+” 候选 -->
    <div class="selected-tag-header" v-else>
      <button class="back-btn" type="button" @click="unselectTag">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <!-- :key 随 id 集合变化整块挂卸，绕开 keyed v-for patch 崩溃 -->
      <div class="selected-tags" :key="selectedKey">
        <TagChip v-for="tag in selectedTags" :key="tag.id" :tag="tag" active removable @remove="removeSelected" />
      </div>
      <div class="tag-add-filter-wrap">
        <button class="tag-add-filter" type="button" :title="t('component.tags_header.add_filter')" @click="togglePicker">+</button>
        <TagCandidatePopover
          v-if="isPickerOpen"
          :selected-ids="props.selectTagIds"
          :candidates="candidates"
          :loading="isCandidatesLoading"
          @pick="pickCandidate"
          @close="isPickerOpen = false"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import BookmarksEmptyView from '~/components/BookmarkList/BookmarksEmptyView.vue'
import TagCandidatePopover from '~/components/BookmarkList/TagCandidatePopover.vue'
import TagChip from '~/components/BookmarkList/TagChip.vue'
import TagSection from '~/components/BookmarkList/TagSection.vue'

import { RESTMethodPath } from '@commons/types/const'
import type { BookmarkTag } from '@commons/types/interface'
import { vOnKeyStroke } from '@vueuse/components'
import { showEditTagModal } from '~/components/Modal'
import Toast, { ToastType } from '~/components/Toast'
import { LocalFirstAdapterKey } from '~/composables/local-first/injection'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    // 已选标签 id（hashid 或 local-first uuid），多个取交集
    selectTagIds?: string[]
    selectTagName?: string
  }>(),
  { selectTagIds: () => [], selectTagName: '' }
)

const emits = defineEmits<{
  // 空数组 = 回到浏览态
  'select-tag': [ids: string[], name?: string]
  'select-untagged': []
}>()

// 用户标签源 / 候选源；null（非 LF）则走 REST。二者都只能在 setup 顶层建一次
const lf = inject(LocalFirstAdapterKey, null)
const userTags = lf?.userTagSource?.() ?? null
const listTagSrc = lf?.bookmarkListTagSource?.() ?? null
const localActive = !!userTags

const selectedIds = computed(() => props.selectTagIds)
const isFiltering = computed(() => selectedIds.value.length > 0)
const selectedKey = computed(() => selectedIds.value.join('|'))

const isTagLoading = ref(false)
const isAddingTagLoading = ref(false)
const isAddingTag = ref(false)
const addingTagName = ref('')

// tags 双轨：LF 只读（fork 已过滤排序）/ REST ref
const restTags = ref<BookmarkTag[]>([])
const tags = computed<BookmarkTag[]>(() => (localActive ? userTags!.tags.value : restTags.value))
// source 缺省视为 auto；system 已废弃，不读
const mineTags = computed(() => tags.value.filter(tag => tag.source === 'mine'))
const autoTags = computed(() => tags.value.filter(tag => tag.source !== 'mine'))
// 引导块：auto 列表已按时间排好，取前 8 个
const onboardingTags = computed(() => autoTags.value.slice(0, 8))

const tagById = (id: string) => tags.value.find(tag => String(tag.id) === id)
const tagIdBody = (tag: BookmarkTag) => (tag.id_kind === 'uuid' ? { tag_uuid: tag.id } : { tag_id: tag.id })

const loadUserTags = async () => {
  if (localActive) return // LF：tags 由响应式驱动
  if (isTagLoading.value) {
    return
  }

  isTagLoading.value = true
  const res = await request().get<BookmarkTag[]>({
    url: RESTMethodPath.TAG_LIST
  })

  if (!res) {
    Toast.showToast({
      text: t('common.error.network'),
      type: ToastType.Error
    })
  } else {
    restTags.value = res.filter(tag => !!tag.display)
  }

  isTagLoading.value = false
}

// 筛选态也要全量列表：已选 chip 的名字从这里解析
loadUserTags()

// 已选 chip：列表里找得到用列表的；单个未知 id 回退 selectTagName；否则原样 id
const selectedTags = computed<BookmarkTag[]>(() =>
  selectedIds.value.map(id => {
    const found = tagById(id)
    if (found) return found
    const name = selectedIds.value.length === 1 && props.selectTagName ? props.selectTagName : id
    return { id: id as unknown as number, name, show_name: name } as BookmarkTag
  })
)
const selectedName = (ids: string[]) => (ids.length ? tagById(ids[0]!)?.show_name || (ids.length === 1 ? props.selectTagName : '') : '')

// name 只在有值时带上，父级按位置参数接
const emitSelect = (ids: string[], name?: string) => {
  if (name) {
    emits('select-tag', ids, name)
  } else {
    emits('select-tag', ids)
  }
}

onMounted(() => {
  // 带着已选标签进来（URL 直达）：回抛一次，父级据此加载列表；此时列表未到，名字沿用父级给的
  if (isFiltering.value) {
    emitSelect([...selectedIds.value], props.selectTagName)
  }
})

// === 浏览态 ===

const addTagClick = () => {
  isAddingTag.value = true
  // 聚焦交由 v-autofocus 指令处理
}

const editTagClick = (tag: BookmarkTag) => {
  // 改名 / 删除 / 降级都走 REST；LF 下本地行经 sync 回流，这里只改 REST 列表
  showEditTagModal({
    tagId: tag.id,
    tagName: tag.show_name,
    source: tag.source ?? 'auto',
    idKind: tag.id_kind ?? 'hashid',
    callback: (id, name) => {
      const target = restTags.value.find(item => item.id === id)
      if (target) target.show_name = name
    },
    deleteCallback: id => {
      restTags.value = restTags.value.filter(item => item.id !== id)
    },
    demoteCallback: id => {
      const target = restTags.value.find(item => item.id === id)
      if (target) target.source = 'auto'
    }
  })
}

// 提升为“我的标签”：REST 用响应替换本地行；LF 只发请求，列表经 sync 更新
const promoteTag = async (tag: BookmarkTag) => {
  const res = await request().post<BookmarkTag>({
    url: RESTMethodPath.PROMOTE_USER_TAG,
    body: tagIdBody(tag)
  })

  if (!res) {
    Toast.showToast({
      text: t('common.error.network'),
      type: ToastType.Error
    })
    return
  }

  if (!localActive) {
    restTags.value = restTags.value.map(item => (item.id === tag.id ? { ...item, ...res, source: 'mine' } : item))
  }
}

const saveTag = async () => {
  if (isAddingTagLoading.value) {
    return
  }

  const tagName = addingTagName.value.trim()
  if (!tagName.length) {
    isAddingTag.value = false
    return
  }

  // LF：本地新建标签，新行经 source 到达
  if (userTags) {
    isAddingTagLoading.value = true
    try {
      await userTags.create(tagName)
    } finally {
      isAddingTag.value = false
      isAddingTagLoading.value = false
      addingTagName.value = ''
    }
    return
  }

  isAddingTagLoading.value = true
  const res = await request().post<BookmarkTag>({
    url: RESTMethodPath.ADD_USER_TAG,
    body: { tag_name: tagName }
  })
  isAddingTagLoading.value = false

  if (!res) {
    Toast.showToast({
      text: t('common.error.network'),
      type: ToastType.Error
    })
    return
  }

  isAddingTag.value = false
  addingTagName.value = ''

  // create 可能认领了已有名字：已在列表里就只更新
  const existing = restTags.value.find(tag => tag.id === res.id)
  if (existing) {
    Object.assign(existing, res)
  } else {
    restTags.value.unshift(res)
  }
}

const onKeyDown = async (e: KeyboardEvent) => {
  if (e.key !== 'Enter') {
    if (e.key === 'Escape') {
      isAddingTag.value = false
    }
    return
  }

  await saveTag()
}

const selectTag = (tag: BookmarkTag) => {
  emitSelect([String(tag.id)], tag.show_name)
}

// === 筛选态 ===

const unselectTag = () => {
  emitSelect([])
}

const removeSelected = (tag: BookmarkTag) => {
  const ids = selectedIds.value.filter(id => id !== String(tag.id))
  emitSelect(ids, selectedName(ids))
}

const isPickerOpen = ref(false)
const isCandidatesLoading = ref(false)
const restCandidates = ref<BookmarkTag[]>([])
// LF：候选是随已选 id 变化的 computed，setup 顶层建一次
const lfCandidates = listTagSrc?.candidates(selectedIds) ?? null
const candidates = computed<BookmarkTag[]>(() => (lfCandidates ? lfCandidates.value : restCandidates.value))

const loadCandidates = async () => {
  if (lfCandidates) return // LF：computed 自己更新
  const ids = selectedIds.value
  if (!ids.length) return

  isCandidatesLoading.value = true
  const res = await request().get<BookmarkTag[]>({
    url: RESTMethodPath.TAG_LIST,
    query: { within: ids.join(',') }
  })
  isCandidatesLoading.value = false

  // 期间选择又变了：丢弃这次结果，watch 会再拉
  if (ids.join(',') !== selectedIds.value.join(',')) return

  if (!res) {
    Toast.showToast({
      text: t('common.error.network'),
      type: ToastType.Error
    })
    restCandidates.value = []
    return
  }

  restCandidates.value = res
}

const togglePicker = () => {
  isPickerOpen.value = !isPickerOpen.value
  if (isPickerOpen.value) {
    loadCandidates()
  }
}

// 选一个候选：追加到交集，弹层保持打开，候选按新集合刷新
const pickCandidate = (tag: BookmarkTag) => {
  const ids = [...selectedIds.value, String(tag.id)]
  emitSelect(ids, selectedName(ids))
}

watch(selectedKey, () => {
  if (!isFiltering.value) {
    isPickerOpen.value = false
    restCandidates.value = []
    return
  }
  if (isPickerOpen.value) {
    loadCandidates()
  }
})
</script>

<style lang="scss" scoped>
.tags-header {
  padding-bottom: 16px;
}

// 添加标签行
.tags-add-row {
  margin-bottom: 16px;
  user-select: none;
}

.tag-add {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border: 1px dashed color-mix(in srgb, var(--slax-accent) 35%, transparent);
  border-radius: 999px;
  background: var(--slax-accent-bg);
  color: var(--slax-accent);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: var(--slax-accent);
    background: color-mix(in srgb, var(--slax-accent) 10%, transparent);
  }

  svg {
    flex-shrink: 0;
    opacity: 0.8;
  }
}

.tag-input-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border: 1px solid var(--slax-accent);
  border-radius: 999px;
  background: var(--slax-accent-bg);
  box-shadow: 0 0 0 3px var(--slax-accent-bg);
  max-width: 320px;

  input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    outline: none;
    font-size: 13px;
    color: var(--slax-text);
    font-family: inherit;

    &::placeholder {
      color: var(--slax-text-light);
    }
  }
}

.tag-input-confirm {
  flex-shrink: 0;
  padding: 3px 10px;
  background: var(--slax-accent);
  color: var(--slax-btn-text);
  border: none;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  transition: opacity 0.12s;

  &:hover {
    opacity: 0.85;
  }
}

// 加载中
.tags-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 24px;

  span {
    font-family: var(--slax-font-serif);
    font-size: var(--slax-fs-body);
    font-weight: 500;
    color: var(--slax-text-muted);
  }
}

// 我的标签为空时的引导块
.mine-onboarding {
  width: 100%;
  padding: 14px 16px;
  border: 1px dashed color-mix(in srgb, var(--slax-accent) 35%, var(--slax-border));
  border-radius: var(--slax-radius);
  background: var(--slax-accent-bg);
}

.mine-onboarding-title {
  font-family: var(--slax-font-serif);
  font-size: var(--slax-fs-body);
  font-weight: 500;
  color: var(--slax-text);
}

.mine-onboarding-desc {
  margin: 4px 0 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--slax-text-muted);
}

.mine-onboarding-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

// 未打标签入口：虚线胶囊
.tag-untagged {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 20px;
  padding: 6px 14px;
  border: 1px dashed var(--slax-border-strong);
  border-radius: 999px;
  background: transparent;
  color: var(--slax-text-muted);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: color-mix(in srgb, var(--slax-accent) 40%, var(--slax-border));
    background: var(--slax-accent-bg);
    color: var(--slax-text);
  }
}

// 已选标签 header
.selected-tag-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--slax-border);
  margin-bottom: 16px;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  background: transparent;
  color: var(--slax-text-muted);
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: var(--slax-surface);
    color: var(--slax-text);
    border-color: color-mix(in srgb, var(--slax-accent) 30%, var(--slax-border));
  }
}

// 不生成盒子，chip 仍是 header 的 flex 子项
.selected-tags {
  display: contents;
}

.tag-add-filter-wrap {
  position: relative;
}

.tag-add-filter {
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px dashed color-mix(in srgb, var(--slax-accent) 35%, var(--slax-border));
  border-radius: 999px;
  background: transparent;
  color: var(--slax-accent);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: var(--slax-accent);
    background: var(--slax-accent-bg);
  }
}
</style>
