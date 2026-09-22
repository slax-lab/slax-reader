<template>
  <div class="bookmark-tags" ref="rootEl">
    <div class="tags-list" :class="{ 'is-reserving': isReserving }">
      <!-- :key 随 id 集合变化整块挂卸，
           绕开 keyed v-for patch 崩溃 -->
      <div v-if="visibleTags.length" :key="tagsKey" class="tags-cells">
        <TagChip
          v-for="tag in visibleTags"
          :key="tag.id"
          :tag="tag"
          legacy
          :legacy-interactive="props.compact"
          :removable="!props.readonly"
          :ai-mark="tag.added_by === 'ai'"
          @click="emit('select-tag', tag)"
          @remove="deleteBookmarkTag(tag.id)"
        />
      </div>

      <!-- compact 专用：不可见度量行，完整渲染 displayTags 量真实宽度，
           与可见 chip 完全解耦（不受 hover 展开删除按钮影响），只用来算 visibleCount -->
      <div v-if="props.compact" class="tags-measure" ref="measureEl" aria-hidden="true">
        <TagChip v-for="tag in displayTags" :key="tag.id" :tag="tag" legacy :legacy-interactive="props.compact" :removable="!props.readonly" :ai-mark="tag.added_by === 'ai'" />
      </div>

      <div class="loading" v-if="isTagLoading">
        <div class="i-svg-spinners:90-ring w-16px" style="color: var(--slax-accent)" />
      </div>

      <div class="tag-add-wrap" v-if="!props.readonly">
        <button ref="add" class="tag-add" :title="isOverflowing ? $t('component.bookmark_tags.more') : $t('common.operate.add')" @click="addingTagClick">
          <svg v-if="!isOverflowing" width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <g transform="translate(4, 4)" fill="currentColor">
              <polygon points="5.25 0 6.75 0 6.75 12 5.25 12" />
              <polygon transform="translate(6, 6) rotate(-90) translate(-6, -6)" points="5.25 0 6.75 0 6.75 12 5.25 12" />
            </g>
          </svg>
          <svg v-else width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <circle cx="4" cy="10" r="1.6" />
            <circle cx="10" cy="10" r="1.6" />
            <circle cx="16" cy="10" r="1.6" />
          </svg>
        </button>
        <!-- Teleport 到 body：列表卡片位于 virtua 虚拟滚动的 item wrapper 内（该 wrapper 带
             contain:layout style，会形成独立层叠上下文），面板留在卡片内部时无论 z-index
             多高都逃不出这层 containment，会被下一张卡片盖住。挪到 body 顶层 + fixed 定位彻底绕开。
             v-if 而非 v-show：整子树挂卸。local-first 下 v-for 吃的是 PowerSync 的 live useQuery，隐藏时 patch 会崩 -->
        <Teleport to="body">
          <div v-if="isAddingTag" class="search-list" ref="searchList" :style="popupStyle" v-on-click-outside="[onClickOutside, { ignore: [add] }]">
            <input
              ref="searchInput"
              v-ime-guard
              type="text"
              :placeholder="$t('component.bookmark_tags.placeholder')"
              v-model="searchText"
              v-on-key-stroke:Enter="[onKeyDown, { eventName: 'keydown' }]"
            />
            <div class="search-result">
              <div class="result-wrapper" ref="resultWrapper" v-if="groupedCandidates.length > 0 || createName" @scroll="onResultScroll">
                <template v-for="group in groupedCandidates" :key="group.key">
                  <div class="group-heading">{{ $t(group.label) }}</div>
                  <div
                    v-for="tag in group.tags"
                    :key="tag.id"
                    class="search-tag"
                    :class="{ active: pending.has(String(tag.id)), attached: attachedIds.has(String(tag.id)) }"
                    @click="toggleCandidate(tag)"
                  >
                    <span class="tag-name">{{ tag.show_name }}</span>
                    <i class="check" v-if="pending.has(String(tag.id)) || attachedIds.has(String(tag.id))" />
                  </div>
                </template>
                <div v-if="createName" class="search-tag create" :class="{ active: pending.has(newKey(createName)) }" @click="togglePending(newKey(createName))">
                  <span class="tag-name">{{ $t('component.bookmark_tags.create', { name: createName }) }}</span>
                  <i class="check" v-if="pending.has(newKey(createName))" />
                </div>
              </div>
            </div>
            <div class="panel-footer">
              <button type="button" class="confirm-btn" @click="commitPending">{{ $t('component.bookmark_tags.confirm', { n: pending.size }) }}</button>
            </div>
            <div class="list-loading" v-if="isAddingLoading">
              <div class="i-svg-spinners:90-ring w-24px" style="color: var(--slax-accent)" />
            </div>
          </div>
        </Teleport>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import TagChip from '~/components/BookmarkList/TagChip.vue'

import { computeVisibleTagCount } from '~/utils/tagOverflow'

import { RESTMethodPath } from '@commons/contracts/const'
import type { BookmarkTag } from '@commons/contracts/interface'
import { vOnClickOutside, vOnKeyStroke } from '@vueuse/components'
import Toast, { ToastType } from '~/components/Toast'
import { type BookmarkTagActions, LocalFirstAdapterKey, SharedUserTagsKey } from '~/composables/local-first/injection'

const props = defineProps({
  bookmarkId: {
    type: Number,
    required: false
  },
  // /b owner 走 REST 增删标签用
  bookmarkUid: {
    type: String,
    required: false,
    default: ''
  },
  // LF 本地标签 key，BookmarkArticle 注入
  // 仅认 bookmarkUuid
  bookmarkUuid: {
    type: String,
    required: false,
    default: ''
  },
  tags: {
    type: Array as PropType<BookmarkTag[]>,
    required: true
  },
  readonly: {
    type: Boolean,
    required: false
  },
  // 列表卡片：小 chip，且不开 live query（见 tagSrc）
  compact: {
    type: Boolean,
    required: false,
    default: false
  }
})

const emit = defineEmits<{
  change: [tags: BookmarkTag[]]
  'select-tag': [tag: BookmarkTag]
}>()

const { t } = useI18n()

// 本地标签源 + catalog；null 走 REST
const lf = inject(LocalFirstAdapterKey, null)
// 必须在 setup 顶层创建：内部 useQuery 有此要求。
// 传响应式 uuid，勿在 watch 里重建（否则崩）。
// compact（列表卡片）不建：每张卡两条 live query 太贵，改走 bookmarkTagActions + 列表共享词表
const tagSrc = shallowRef(!props.compact ? (lf?.bookmarkTagSource?.(toRef(props, 'bookmarkUuid')) ?? null) : null)
const tagActions: BookmarkTagActions | null = props.compact ? (lf?.bookmarkTagActions?.() ?? null) : null
const sharedUserTags = props.compact ? inject(SharedUserTagsKey, null) : null
// 挂载后再激活 LF，避免水合分叉
const isMounted = ref(false)
const localActive = computed(() => isMounted.value && tagSrc.value !== null)

const add = ref<HTMLButtonElement>()
const searchList = ref<HTMLDivElement>()
const searchInput = ref<HTMLInputElement>()
const resultWrapper = ref<HTMLDivElement>()
// 面板 fixed 定位：viewport 坐标，随外层滚动/resize 更新
const popupStyle = ref<{ top: string; left: string }>({ top: '0px', left: '0px' })

// 双轨：LF 只读 / REST ref
const restBookmarkTags = ref<BookmarkTag[]>(props.tags || [])
const restSearchTags = ref<BookmarkTag[]>([])
// LF 激活恒用本地源
// 避免 REST/LF 切源重挂崩溃
const bookmarkTags = computed<BookmarkTag[]>(() => (localActive.value ? tagSrc.value!.tags.value : restBookmarkTags.value))
const searchTags = computed<BookmarkTag[]>(() => {
  if (localActive.value) return tagSrc.value!.userTags.value
  if (sharedUserTags) return sharedUserTags.tags.value
  return restSearchTags.value
})

// 去抖：一次写入常连发多次变更，
// 合并到下一 tick，避免同 flush 触发崩溃。
const displayTags = shallowRef<BookmarkTag[]>(bookmarkTags.value)
let tagsFlushScheduled = false
watch(bookmarkTags, () => {
  if (tagsFlushScheduled) return
  tagsFlushScheduled = true
  nextTick(() => {
    tagsFlushScheduled = false
    displayTags.value = bookmarkTags.value // 读最新值，合并这一拍内的多次抖动
  })
})

// key 随 id 集合变化、整块挂卸，
// 绕开就地 patch 的 null-anchor 崩溃。
// 注意：裁剪（visibleCount）不影响这个 key —— 裁剪只改变渲染 displayTags 的前几个，
// 不改变 id 集合，与上面的崩溃规避机制解耦。
const tagsKey = computed(() => displayTags.value.map(tag => tag.id).join('|'))

// compact 专用：宽度不够时裁剪展示的 tag 数量，把 + 换成 ···（点击行为不变）。
// 用不可见的 measureEl（完整渲染 displayTags）量真实 chip 宽度，避开可见 chip 的 hover 动画干扰。
const rootEl = ref<HTMLDivElement>()
const measureEl = ref<HTMLDivElement>()
const visibleCount = ref(Infinity)
const isOverflowing = computed(() => props.compact && visibleCount.value < displayTags.value.length)
const visibleTags = computed(() => (props.compact ? displayTags.value.slice(0, visibleCount.value) : displayTags.value))

// chip 间隔对齐 .tags-list 的 gap-8px；ADD_BTN 是 +/··· 按钮自身宽度；
// SAFETY_MARGIN 吃掉 legacy chip hover 时删除按钮 0→14px 展开动画可能带来的边界闪动
const TAG_GAP = 8
const ADD_BTN_WIDTH = 28
const SAFETY_MARGIN = 28

const recomputeVisibleCount = () => {
  if (!props.compact) return
  const container = rootEl.value
  const measure = measureEl.value
  if (!container || !measure) return
  // 容器尚未真实布局（首帧 / 无布局引擎的测试环境）时 clientWidth 恒为 0，
  // 不能当真实宽度用——维持默认全显，等 ResizeObserver 给出第一份真实测量再收窄
  if (container.clientWidth <= 0) return

  const chipWidths = (Array.from(measure.children) as HTMLElement[]).map(chip => chip.offsetWidth)
  const count = computeVisibleTagCount({
    availableWidth: container.clientWidth,
    chipWidths,
    gap: TAG_GAP,
    addButtonWidth: ADD_BTN_WIDTH,
    safetyMargin: SAFETY_MARGIN
  })

  visibleCount.value = count >= displayTags.value.length ? Infinity : count
}

const recomputeVisibleCountDebounced = useDebounceFn(recomputeVisibleCount, 200, { maxWait: 1000 })

// LF 首查未返回，预留一行占位防跳动
const isReserving = computed(() => localActive.value && !!tagSrc.value?.isLoading?.value)

const isTagLoading = ref(false)
const isAddingLoading = ref(false)
const isAddingTag = ref(false)
const searchText = ref('')
// 面板里勾选、尚未提交的项：已有标签 → String(id)；新建 → 'new:' + name
const pending = shallowRef(new Set<string>())
// 重开面板时恢复列表滚动位置
let resultScrollTop = 0

const NEW_PREFIX = 'new:'
const newKey = (name: string) => NEW_PREFIX + name
const isNewKey = (key: string) => key.startsWith(NEW_PREFIX)

const attachedIds = computed(() => new Set(bookmarkTags.value.map(tag => String(tag.id))))

const searchResultTags = computed(() => {
  if (!searchText.value) return searchTags.value
  return searchTags.value.filter(tag => tag.show_name.includes(searchText.value))
})

// 分组：我的在前，自动在后；空组不出标题
const groupedCandidates = computed(() => {
  const mine = searchResultTags.value.filter(tag => tag.source !== 'auto')
  const auto = searchResultTags.value.filter(tag => tag.source === 'auto')
  const groups: { key: string; label: string; tags: BookmarkTag[] }[] = []
  if (mine.length) groups.push({ key: 'mine', label: 'component.bookmark_tags.group_mine', tags: mine })
  if (auto.length) groups.push({ key: 'auto', label: 'component.bookmark_tags.group_auto', tags: auto })
  return groups
})

// 输入了词表里没有的名字（大小写敏感）→ 给一个“创建”行
const exactMatch = computed(() => searchTags.value.find(tag => tag.show_name === searchText.value) ?? null)
const createName = computed(() => (searchText.value && !exactMatch.value ? searchText.value : ''))

// 搜索词变了，之前勾的“创建 xxx”已经看不见，不能留在 pending 里被提交
watch(createName, name => {
  const keep = name ? newKey(name) : ''
  const stale = [...pending.value].filter(key => key.startsWith('new:') && key !== keep)
  if (stale.length < 1) return
  const next = new Set(pending.value)
  stale.forEach(key => next.delete(key))
  pending.value = next
})

watch(
  () => props.tags,
  newTags => {
    if (localActive.value) return // LF：不接 props.tags
    restBookmarkTags.value = newTags
  },
  { deep: true }
)

// 按 + 按钮当前位置算 fixed 坐标（viewport 绝对值，Teleport 到 body 后不再受任何祖先 transform/offset 影响）
const updatePopupPosition = () => {
  const rect = add.value?.getBoundingClientRect()
  if (!rect) return
  popupStyle.value = { top: `${rect.bottom + 10}px`, left: `${rect.left}px` }
}

watch(
  () => isAddingTag.value,
  value => {
    if (!value) return
    updatePopupPosition()
    // v-if 弹层，nextTick 再定位/聚焦（首次挂载时 rect 更准）
    nextTick(() => {
      updatePopupPosition()
      searchInput.value?.focus()
      restoreResultScroll()
    })
    searchingTags()
  }
)

// 面板开着时列表所在容器（inbox 主区域/文章侧栏）可能滚动，+ 按钮位置会变，需跟随重新定位
const onReposition = () => {
  if (!isAddingTag.value) return
  updatePopupPosition()
}

// compact 专用：容器宽度变化（窗口 resize / 侧栏展开等）时重算能放下几个 chip。
// virtua 虚拟列表滚出可视区会整例销毁（非复用实例），组件卸载时 useResizeObserver 自动 disconnect，不会串到别的卡片。
if (props.compact) {
  useResizeObserver(rootEl, recomputeVisibleCountDebounced)
  // tag 增删后度量行内容变了，nextTick 等 DOM 更新完再重算
  watch(displayTags, () => nextTick(recomputeVisibleCount))
}

onMounted(() => {
  isMounted.value = true
  window.addEventListener('scroll', onReposition, { passive: true, capture: true })
  window.addEventListener('resize', onReposition, { passive: true })
  if (props.compact) nextTick(recomputeVisibleCount)
})

onUnmounted(() => {
  window.removeEventListener('scroll', onReposition, true)
  window.removeEventListener('resize', onReposition)
})

const onResultScroll = (e: Event) => {
  resultScrollTop = (e.target as HTMLElement).scrollTop
}

const restoreResultScroll = () => {
  if (resultWrapper.value && resultScrollTop) resultWrapper.value.scrollTop = resultScrollTop
}

const searchingTags = async () => {
  if (localActive.value || sharedUserTags) return // LF：候选来自本地词表
  if (isAddingLoading.value) return
  isAddingLoading.value = true
  const res = await request().get<BookmarkTag[]>({ url: RESTMethodPath.TAG_LIST })
  if (res) restSearchTags.value = res
  isAddingLoading.value = false
  nextTick(restoreResultScroll)
}

const togglePending = (key: string) => {
  const next = new Set(pending.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  pending.value = next
}

const toggleCandidate = (tag: BookmarkTag) => {
  if (attachedIds.value.has(String(tag.id))) return // 已贴上的只展示
  togglePending(String(tag.id))
}

const mergeTags = (base: BookmarkTag[], extra: BookmarkTag[]) => {
  const seen = new Set(base.map(tag => String(tag.id)))
  const merged = [...base]
  for (const tag of extra) {
    if (seen.has(String(tag.id))) continue
    seen.add(String(tag.id))
    merged.push(tag)
  }
  return merged
}

const closePanel = () => {
  isAddingTag.value = false
}

// 一次提交面板里所有勾选；出错保留 pending 让用户重试
let isCommitting = false
const commitPending = async () => {
  if (isCommitting) return
  if (pending.value.size === 0) {
    closePanel()
    return
  }
  const keys = [...pending.value]
  const existingKeys = keys.filter(key => !isNewKey(key))
  const newNames = keys.filter(isNewKey).map(key => key.slice(NEW_PREFIX.length))
  const byKey = new Map(searchTags.value.map(tag => [String(tag.id), tag]))

  isCommitting = true
  isAddingLoading.value = true
  try {
    let added: BookmarkTag[]
    if (tagSrc.value || tagActions) {
      added = await commitLocal(tagSrc.value ?? tagActions!, existingKeys, newNames, byKey)
    } else if (lf) {
      // LF 环境但 adapter 没给写入器：uuid 不能落到 REST 的 hashid 解码上
      Toast.showToast({ text: t('common.tips.operate_failed'), type: ToastType.Error })
      return
    } else {
      // 非 LF REST：保留 bookmark_uid，owner 在 bookmarkId=0 时靠它增删
      if (!props.bookmarkId && !props.bookmarkUid) {
        closePanel()
        return
      }
      const res = await request().post<BookmarkTag[]>({
        url: RESTMethodPath.ADD_BOOKMARK_TAGS,
        body: {
          bookmark_id: props.bookmarkId || undefined,
          bookmark_uid: props.bookmarkUid || undefined,
          tags: [...existingKeys.map(key => ({ id: byKey.get(key)?.id ?? key })), ...newNames.map(name => ({ name }))]
        }
      })
      if (!res) return // request 层已 toast
      added = res
      restSearchTags.value = mergeTags(restSearchTags.value, res)
    }

    const merged = mergeTags(bookmarkTags.value, added)
    if (!localActive.value) restBookmarkTags.value = merged
    emit('change', merged)
    pending.value = new Set()
    searchText.value = ''
    closePanel()
  } catch (error) {
    console.error(error)
    Toast.showToast({ text: t('common.tips.operate_failed'), type: ToastType.Error })
  } finally {
    isCommitting = false
    isAddingLoading.value = false
  }
}

// LF：先建新标签，再一次 setTags；源不支持 setTags 时退回逐个 add
const commitLocal = async (
  writer: Pick<BookmarkTagActions, 'add' | 'createUserTag'> & Partial<Pick<BookmarkTagActions, 'setTags'>>,
  existingKeys: string[],
  newNames: string[],
  byKey: Map<string, BookmarkTag>
) => {
  const created: BookmarkTag[] = []
  for (const name of newNames) created.push(await writer.createUserTag(name))
  const newIds = [...existingKeys, ...created.map(tag => String(tag.id))]
  const currentIds = bookmarkTags.value.map(tag => String(tag.id))
  if (writer.setTags) {
    await writer.setTags(props.bookmarkUuid, [...currentIds, ...newIds])
  } else {
    for (const id of newIds) await writer.add(props.bookmarkUuid, id)
  }
  return [...existingKeys.map(key => byKey.get(key)).filter((tag): tag is BookmarkTag => !!tag), ...created]
}

const deleteBookmarkTag = async (tagId: number) => {
  const remaining = () => bookmarkTags.value.filter(tag => tag.id !== tagId)

  // LF：本地解除标签关联
  const writer = tagSrc.value ?? tagActions
  if (writer) {
    const next = remaining()
    try {
      await writer.remove(props.bookmarkUuid, String(tagId))
    } catch {
      Toast.showToast({ text: t('common.tips.operate_failed'), type: ToastType.Error })
      return
    }
    if (!localActive.value) restBookmarkTags.value = next
    emit('change', next)
    return
  }
  if (lf) {
    Toast.showToast({ text: t('common.tips.operate_failed'), type: ToastType.Error })
    return
  }

  // 非 LF REST：保留 bookmark_uid
  if (!props.bookmarkId && !props.bookmarkUid) return
  request().post<{ ok: boolean }>({
    url: RESTMethodPath.DELETE_BOOKMARK_TAG,
    body: { bookmark_id: props.bookmarkId || undefined, bookmark_uid: props.bookmarkUid || undefined, tag_id: tagId }
  })
  restBookmarkTags.value = remaining()
  emit('change', restBookmarkTags.value)
}

// Enter：先把精确命中（或“创建”行）加进 pending，再提交
const onKeyDown = async (e: KeyboardEvent) => {
  if (e.key !== 'Enter' || !isAddingTag.value) return
  const text = searchText.value
  if (text) {
    const match = exactMatch.value
    const key = match ? String(match.id) : newKey(text)
    const attached = match ? attachedIds.value.has(key) : false
    if (!attached && !pending.value.has(key)) togglePending(key)
  }
  await commitPending()
}

const onClickOutside = () => {
  void commitPending()
}

const addingTagClick = (e: MouseEvent) => {
  e.stopPropagation()
  // 面板开着时按 + 等同确认：click-outside 也会走一遍 commit，isCommitting 兜底去重
  if (isAddingTag.value) {
    void commitPending()
    return
  }
  isAddingTag.value = true
}
</script>

<style lang="scss" scoped>
.bookmark-tags {
  --style: relative;
  // compact 场景下是 BookmarkCell .article-tags（flex）里的唯一子项：flex 子项默认按内容
  // 宽度定size，不会自动撑满父级分给它的空间；width:100% 让它先撑满 .article-tags 分到的
  // 可用宽度，min-width:0 再解除"内容自动最小宽度"（否则会被内部 nowrap chip 总宽顶开）。
  // 两者都是 flex 语境才生效，非 compact（文章页 block 布局）下是无副作用的默认值。
  width: 100%;
  min-width: 0;
}

.tags-list {
  --style: flex flex-wrap items-center gap-8px;

  // 预留一行高度
  &.is-reserving {
    min-height: 28px;
  }
}

// 不生成盒子，chip 仍是 flex 子项
.tags-cells {
  display: contents;
}

// 度量行：脱离视觉与文档流，只用来读 chip 真实宽度；BookmarkCell.vue 的
// .article-tags 外层 overflow:hidden 兜底二次遮蔽，双重保险不会露出
.tags-measure {
  position: absolute;
  visibility: hidden;
  display: flex;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}

.loading {
  --style: flex-center h-24px;
}

.tag-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px dashed var(--slax-border);
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  color: var(--slax-text-light);
  transition: all 0.15s;

  &:hover {
    border-color: var(--slax-accent);
    color: var(--slax-accent);
    background: var(--slax-accent-bg);
  }

  svg {
    width: 14px;
    height: 14px;
  }
}

.search-list {
  // fixed 定位（Teleport 到 body），top/left 由脚本按 + 按钮 rect 算好写进 style
  --style: fixed w-260px rounded-sm overflow-hidden border-(1px solid border) shadow-warm bg-surface-solid px-12px py-16px pb-12px z-200;

  input {
    --style: rounded-sm bg-surface border-(1px solid border) px-10px py-9px h-36px text-(aux txt-light) line-height-18px w-full transition-all duration-300;

    &:focus {
      border-color: var(--slax-accent-soft);
      color: var(--slax-text);
      outline: none;
    }
  }

  .search-result {
    --style: mt-12px relative;

    .result-wrapper {
      --style: max-h-360px py-4px overflow-y-auto;

      .group-heading {
        --style: 'px-10px pt-8px pb-4px not-first:(mt-4px) text-(11px txt-light) uppercase tracking-wide select-none';
      }

      .search-tag {
        --style: 'rounded-sm flex items-center justify-between gap-8px cursor-pointer px-10px py-8px mt-4px transition-all duration-normal whitespace-nowrap';
        border: 1px solid var(--slax-border);
        color: var(--slax-text-muted);
        font-size: var(--slax-fs-meta);

        .tag-name {
          --style: overflow-hidden text-ellipsis;
        }

        &:hover {
          border-color: var(--slax-accent-soft);
          background: var(--slax-accent-bg);
        }

        &.active {
          border-color: var(--slax-accent);
          background: var(--slax-accent-bg);
          color: var(--slax-accent);
        }

        &.attached {
          cursor: default;
          opacity: 0.5;

          &:hover {
            border-color: var(--slax-border);
            background: transparent;
          }
        }

        &.create {
          border-style: dashed;
        }

        .check {
          --style: shrink-0 w-12px h-6px;
          border-left: 2px solid currentColor;
          border-bottom: 2px solid currentColor;
          transform: translateY(-2px) rotate(-45deg);
        }
      }
    }
  }

  .panel-footer {
    --style: mt-12px flex justify-end;

    .confirm-btn {
      --style: rounded-sm px-12px py-6px text-(12px) cursor-pointer transition-all duration-normal;
      border: 1px solid var(--slax-accent);
      background: var(--slax-accent);
      color: var(--slax-surface-solid);

      &:hover {
        opacity: 0.9;
      }
    }
  }

  .list-loading {
    --style: absolute inset-0 flex-center;
    background: color-mix(in srgb, var(--slax-surface-solid) 80%, transparent);
  }
}
</style>
