// 书签列表筛选状态 + 路由读取 + 纯导航 helper
// 职责边界（重构决策1/4）：只持有 filter 状态 ref 和「无副作用的纯导航」helper
//   （仅改 ref + navigateTo），不碰列表数据、不碰页面级 scrollY。
//   编排动作（selectTopic/selectCollection/selectTab：组合 reset/load + scrollY）留在页面层，
//   以此避免与 useBookmarkData 形成构造期循环依赖。
import { computed, ref } from 'vue'

/** "a,b" 或 ["a","b"] → 去空去重的字符串数组；0 / NaN 之类的旧占位值不算 */
export const parseTopicIds = (raw: unknown): string[] => {
  const parts = Array.isArray(raw) ? raw.map(v => `${v ?? ''}`) : `${raw ?? ''}`.split(',')
  return [...new Set(parts.map(p => p.trim()).filter(p => p.length > 0 && p !== '0'))]
}

export const useBookmarkFilter = () => {
  const route = useRoute()

  const filterStatus = ref(`${route.query.filter || 'inbox'}`)
  // 多标签交集：topic_ids=a,b（hashid 或 local-first uuid，都是字符串）；旧链接的 topic_id 也认
  const filterTopicIds = ref<string[]>(parseTopicIds(route.query.topic_ids ?? route.query.topic_id))
  const filterTopicName = ref(`${route.query.topic_name || ''}`)
  const filterCollectionId = ref(Number(route.query.c_id || ''))
  const filterCollectionCode = ref<string>(String(route.query.c_code || ''))
  const filterCollectionName = ref<string>(String(route.query.c_name || ''))

  const isInTrash = computed(() => filterStatus.value === 'trashed')
  const isCurrentInboxTab = computed(() => filterStatus.value === 'inbox' || !filterStatus.value)

  // 纯导航：选择一组话题（空数组 = 回到标签列表）。改 ref + navigateTo（replace:true），不触发列表加载
  const applyTopics = async (ids: string[], name = '') => {
    const clean = [...new Set(ids.map(id => `${id}`.trim()).filter(id => id.length > 0))]
    filterTopicIds.value = clean
    filterTopicName.value = clean.length > 0 ? name : ''

    await navigateTo(`/bookmarks?filter=topics${clean.length > 0 ? '&topic_ids=' + encodeURIComponent(clean.join(',')) : ''}`, {
      replace: true
    })
  }

  // 纯导航：选择合集。改 collection ref + navigateTo（replace:true）
  const applyCollection = async (info: { id: number; name: string; code: string } | null) => {
    const collectParams: Record<string, number | string> = {}
    if (info) {
      info.id && (collectParams.c_id = info.id)
      info.name && (collectParams.c_name = info.name)
      info.code && (collectParams.c_code = info.code)
    }

    filterCollectionId.value = info?.id || 0
    filterCollectionCode.value = info?.code || ''
    filterCollectionName.value = info?.name || ''

    const paramsStr = Object.keys(collectParams)
      .map(key => `${key}=${collectParams[key]}`)
      .join('&')

    await navigateTo(`/bookmarks?filter=collections${paramsStr.length > 0 ? '&' + paramsStr : ''}`, {
      replace: true
    })
  }

  // 纯导航：切换 tab。改 filterStatus + 清零 topic/collection id + navigateTo（replace:true）
  //   改 filterStatus 后由页面 watch(filterStatus) 触发重载，故此处不调 onLoadMore
  const applyTab = async (type: string) => {
    filterStatus.value = type
    filterCollectionId.value = 0
    filterTopicIds.value = []

    await navigateTo(`/bookmarks?filter=${type}`, {
      replace: true
    })
  }

  return {
    filterStatus,
    filterTopicIds,
    filterTopicName,
    filterCollectionId,
    filterCollectionCode,
    filterCollectionName,
    isInTrash,
    isCurrentInboxTab,
    applyTopics,
    applyCollection,
    applyTab
  }
}
