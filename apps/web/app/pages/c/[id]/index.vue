<template>
  <div class="collection-page">
    <!-- 顶栏 -->
    <header class="cp-topbar">
      <div class="cp-topbar-inner">
        <div class="cp-topbar-left">
          <button class="cp-logo" @click="navigateTo('/')">
            <img src="@images/icon-logo-bookmark.png" width="24" height="24" alt="" />
            <span class="cp-logo-text">{{ $t('common.app.name') }}</span>
          </button>
          <ClientOnly><ThemeSwitcher /></ClientOnly>
        </div>
      </div>
    </header>

    <main class="cp-shell">
      <!-- 加载态 -->
      <div v-if="pending" class="cp-loading">
        <div class="i-svg-spinners:90-ring w-2em" style="color: var(--slax-accent)"></div>
      </div>

      <!-- 错误态：合集不存在 -->
      <section v-else-if="notFound" class="cp-empty-view">
        <div class="cp-empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </div>
        <h3 class="cp-empty-title">{{ $t('page.c_index.not_found_title') }}</h3>
        <p class="cp-empty-desc">{{ $t('page.c_index.not_found_desc') }}</p>
      </section>

      <!-- 关闭态（整页锁态） -->
      <section v-else-if="isClosed" class="cp-empty-view">
        <!-- 角色判定前 loading 占位，避免文案闪变 -->
        <div v-if="!isOwner && !roleResolved" class="i-svg-spinners:90-ring w-2em" style="color: var(--slax-accent)"></div>
        <template v-else>
          <div class="cp-empty-icon" aria-hidden="true">
            <!-- icon-empty-lock.svg -->
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="5" y="10" width="14" height="10" rx="2" />
              <path d="M8,10 L8,7 C8,4.790861 9.790861,3 12,3 C14.209139,3 16,4.790861 16,7 L16,10" />
              <circle cx="12" cy="15" r="1" />
            </svg>
          </div>
          <template v-if="isOwner">
            <h3 class="cp-empty-title">{{ $t('page.collection_manage.status_closed') }}</h3>
            <p class="cp-empty-desc">{{ $t('page.c_index.closed_owner_desc') }}</p>
            <div class="cp-empty-actions">
              <button class="cp-cta-btn is-visitor" type="button" @click="goManage">{{ $t('page.c_index.closed_owner_cta') }}</button>
            </div>
          </template>
          <template v-else-if="isSubscribed">
            <h3 class="cp-empty-title">{{ $t('page.c_index.closed_subscriber_title', { name: displayTitle }) }}</h3>
            <p class="cp-empty-desc">{{ $t('page.c_index.closed_subscriber_desc') }}</p>
            <div class="cp-empty-actions">
              <button class="cp-cta-btn is-visitor" type="button" @click="unsubscribeFromClosed">{{ $t('page.c_index.closed_unsubscribe') }}</button>
            </div>
          </template>
          <template v-else>
            <h3 class="cp-empty-title">{{ $t('page.c_index.closed_visitor_title', { name: displayTitle }) }}</h3>
            <p class="cp-empty-desc">{{ $t('page.c_index.closed_visitor_desc') }}</p>
            <div class="cp-empty-actions">
              <button class="cp-cta-btn is-visitor" type="button" @click="navigateTo('/login')">{{ $t('page.c_index.closed_visitor_cta') }}</button>
            </div>
          </template>
        </template>
      </section>

      <template v-else-if="info">
        <!-- Hero -->
        <section class="cp-hero" :class="{ 'has-subscription-note': showSubscriptionNote }">
          <div class="cp-copy">
            <div v-if="isOwner" class="cp-badge">{{ $t('page.c_index.badge') }}</div>
            <h1 class="cp-title">{{ displayTitle }}</h1>
            <p v-if="info.description" class="cp-desc">{{ info.description }}</p>
            <div class="cp-stats">
              <div class="cp-stat">
                <span class="cp-stat-value">{{ articleCount }}</span>
                <span class="cp-stat-label">{{ $t('page.c_index.stat_articles') }}</span>
              </div>
              <div v-if="showSubscriberStat" class="cp-stat">
                <span class="cp-stat-value">{{ subscriberCount }}</span>
                <span class="cp-stat-label">{{ $t('page.c_index.stat_subscribers') }}</span>
              </div>
            </div>
          </div>

          <!-- 判定前骨架，后切文案 -->
          <p class="cp-note" :class="{ 'is-invisible': roleResolved && !showSubscriptionNote }">
            <Transition name="cp-fade" mode="out-in">
              <span v-if="!roleResolved" key="sk" class="cp-note-skeleton cp-skeleton" aria-hidden="true"></span>
              <span v-else-if="role === 'subscriber'" key="sub" class="cp-note-body">
                {{ $t('page.c_index.note_subscriber', { owner: ownerName }) }}
                <span class="cp-note-divider" aria-hidden="true"></span>
                <NuxtLink class="cp-note-link" to="/bookmarks?filter=inbox">{{ $t('page.c_index.goto_inbox') }}</NuxtLink>
              </span>
              <span v-else key="vis" class="cp-note-body">{{ $t('page.c_index.note_visitor', { owner: ownerName }) }}</span>
            </Transition>
          </p>

          <!-- 操作区：分享 + 主 CTA -->
          <div class="cp-actions">
            <div ref="shareMenuRef" class="cp-popover-menu" :class="{ open: shareOpen }">
              <button class="cp-icon-btn" type="button" :aria-label="$t('page.c_index.share')" :title="$t('page.c_index.share')" @click.stop="shareOpen = !shareOpen">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" />
                </svg>
              </button>
              <div class="cp-popover" role="menu">
                <button class="cp-popover-item" type="button" role="menuitem" @click="copyShareLink">
                  <span>{{ $t('page.c_index.copy_link') }}</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                </button>
                <button class="cp-popover-item" type="button" role="menuitem" @click="shareToTwitter">
                  <span>{{ $t('page.c_index.share_twitter') }}</span>
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path
                      d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817-5.966 6.817H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <!-- 判定前骨架，后淡入按钮 -->
            <Transition name="cp-fade" mode="out-in">
              <span v-if="!roleResolved" key="sk" class="cp-action-skeleton cp-skeleton" aria-hidden="true"></span>
              <button v-else-if="isOwner" key="manage" class="cp-manage-btn" type="button" @click="goManage">{{ $t('page.c_index.manage') }}</button>
              <SubscribeCollectionButton v-else key="sub" :collection-code="collectionCode" :subscribed="isSubscribed" @update="onSubscribeUpdate" />
            </Transition>
          </div>
        </section>

        <!-- 文章列表 -->
        <section class="cp-list-section" :aria-label="$t('page.c_index.stat_articles')">
          <template v-if="bookmarks.length">
            <div class="cp-article-list">
              <template v-for="group in groups" :key="group.key">
                <div v-if="group.label" class="cp-date-group">{{ group.label }}</div>
                <BookmarkCell v-for="bm in group.items" :key="bm.bookmark_uuid" :bookmark="bm" :owner-avatar="info.publisher_avatar" />
              </template>
              <!-- 尽头文案仅在最后一页显示；simple 模式不知总页数，交给箭头翻页，故不显 -->
              <div v-if="!SIMPLE_PAGER && page >= totalPages" class="cp-list-end">{{ $t('page.c_index.list_end') }}</div>
            </div>
            <!-- 页码选择器 -->
            <CollectionPager :page="page" :total-pages="totalPages" :simple="SIMPLE_PAGER" />
          </template>
          <!-- 空态（对齐 /bookmarks） -->
          <div v-else class="cp-empty-inline">
            <div class="cp-empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </div>
            <h3 class="cp-empty-title">{{ $t('page.c_index.empty_title') }}</h3>
            <p class="cp-empty-desc">{{ $t('page.c_index.empty_desc') }}</p>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import BookmarkCell from '@/components/Collection/BookmarkCell.vue'
import CollectionPager from '@/components/Collection/CollectionPager.vue'
import SubscribeCollectionButton from '@/components/Collection/SubscribeCollectionButton.vue'
import ThemeSwitcher from '~/components/global/ThemeSwitcher.vue'

import { eventLog } from '@/utils/analytics'
import { copyText } from '@commons/utils/string'

import type { UserShareCollectInfoResp, UserShareCollectListItem, UserSubscribeStatus } from '@commons/types/interface'
import { RESTMethodPath } from '@commons/types-pro'
import { ClientOnly } from '#components'
import Toast, { ToastType } from '~/components/Toast'
import { useUserStore } from '~/stores/user'

const { t, locale } = useI18n()
const route = useRoute()
const collectionCode = String(route.params.id)

// 是否整页进入。必须在 setup 里同步取，onMounted 时 isHydrating 已被置回
// SPA 跳转不产生 document 请求，plugin 抓不到，只能在这里补埋
const isSsrEntry = import.meta.server || useNuxtApp().isHydrating

// 每页 10 条；page 严格正整数
const PAGE_SIZE = 10
const page = computed(() => {
  const n = Number(route.query.page)
  return Number.isInteger(n) && n >= 1 ? n : 1
})

// SSR 首屏取数（内部 content 通道）
const {
  data: info,
  pending,
  error
} = await useAsyncData(
  `collection-${collectionCode}`,
  () =>
    useRequestFetch()<UserShareCollectInfoResp>(`/api/collection/${collectionCode}`, {
      query: { page: page.value }
    }).catch((e: { statusCode?: number }) => {
      // 404→null(notFound)；其它抛出→错误页
      if (e?.statusCode === 404) return null
      throw e
    }),
  { watch: [page] }
)

// 上游错误→错误页；翻页失败靠 watch
if (error.value) throw createError({ statusCode: 502, statusMessage: 'collection service unavailable', fatal: true })
watch(error, e => {
  if (e) showError(createError({ statusCode: 502, statusMessage: 'collection service unavailable' }))
})

const bookmarks = computed<UserShareCollectListItem[]>(() => info.value?.list ?? [])
// page>1 却空列表→404（按真实列表长度，防 stats 多计出空尾页）
const isPagedOutEmpty = computed(() => !!info.value && info.value.status !== 0 && page.value > 1 && bookmarks.value.length === 0)

const notFound = computed(() => !info.value || isPagedOutEmpty.value)
const isClosed = computed(() => info.value?.status === 0)
const isOwner = computed(() => info.value?.is_owner === true)

const articleCount = computed(() => info.value?.bookmark_count ?? bookmarks.value.length)
// 星标为 0 用简易页码器
const SIMPLE_PAGER = computed(() => articleCount.value === 0)
// 总页数：星标总数/每页，至少 1
const totalPages = computed(() => Math.max(1, Math.ceil((info.value?.bookmark_count ?? 0) / PAGE_SIZE)))
const subscriberCount = computed(() => info.value?.subscrition_count ?? 0)

// 原规则:越界回跳末页(simple 不用)
const isOutOfRange = () =>
  !SIMPLE_PAGER.value && !!info.value && !isClosed.value && typeof info.value.bookmark_count === 'number' && info.value.bookmark_count > 0 && page.value > totalPages.value
const outOfRangeTarget = () => (totalPages.value > 1 ? { query: { page: String(totalPages.value) } } : { query: {} })
if (isOutOfRange()) await navigateTo(outOfRangeTarget(), { redirectCode: 302 })
watch(page, () => {
  if (import.meta.client && isOutOfRange()) navigateTo(outOfRangeTarget(), { redirectCode: 302 })
})
// 观测：把 curator 判定交给 nitro plugin（server/plugins/visit-abort.ts）写进 collection_visit
if (import.meta.server) {
  const reqEvent = useRequestEvent()
  if (reqEvent) reqEvent.context.__isCurator = info.value?.is_owner === true
}

const ownerName = computed(() => info.value?.publisher_name ?? '')

// 标题用后端 collection_name
const displayTitle = computed(() => info.value?.collection_name ?? '')

// ── 订阅态（客户端校验） ──
const subscribeStatus = ref<UserSubscribeStatus>()
const isSubscribed = computed(() => {
  const s = subscribeStatus.value
  return !!(s?.subscribed && !s.deleted && !s.cancelled)
})

// 角色判定前隐藏，避免 hydration 跳变
const roleResolved = ref(false)

const checkSubscribed = async () => {
  // owner 由 SSR 已判定，省一次订阅查询
  if (isOwner.value) {
    roleResolved.value = true
    return
  }
  const userStore = useUserStore()
  try {
    // 未登录 getUserInfo 抛错→visitor
    if (!userStore.userInfo) {
      await userStore.getUserInfo({ refresh: true })
    }
    const res = await request().post<UserSubscribeStatus>({
      url: RESTMethodPath.COLLECT_SUBSCRIBED,
      body: { collect_code: collectionCode },
      errorInterceptors: () => {}
    })
    if (res) subscribeStatus.value = res
  } catch {
    /* 未登录/无订阅 */
  } finally {
    // 角色已判定
    roleResolved.value = true
  }
}

// 写成功即权威，直接落本地态
// 勿回读 /subscribed（缓存旧值）
const onSubscribeUpdate = (subscribed: boolean) => {
  subscribeStatus.value = { subscribed, deleted: false, cancelled: false, end_time: subscribeStatus.value?.end_time ?? '' }
}

// 三视角判定
type CollectionRole = 'creator' | 'subscriber' | 'visitor'
const role = computed<CollectionRole>(() => {
  if (isOwner.value) return 'creator'
  if (isSubscribed.value) return 'subscriber'
  return 'visitor'
})

// Curator 恒显；他人满 10 订阅才显
const SUBSCRIBER_STAT_THRESHOLD = 10
const showSubscriberStat = computed(() => isOwner.value || subscriberCount.value >= SUBSCRIBER_STAT_THRESHOLD)
// 提示行：creator 无
const showSubscriptionNote = computed(() => role.value !== 'creator' && !isClosed.value)

// ── 按月分组 ──
const monthLabel = (d: Date | null): string => {
  if (!d || Number.isNaN(d.getTime())) return ''
  if (locale.value === 'zh') return t('page.c_index.month_label', { year: d.getFullYear(), month: d.getMonth() + 1 })
  return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(d)
}

// 按月份分组（倒序）；统一按 starred_at
const starTime = (item: UserShareCollectListItem): string => item.starred_at || ''
const timeOf = (item: UserShareCollectListItem): number => {
  const raw = starTime(item)
  const t = raw ? new Date(raw).getTime() : NaN
  return Number.isNaN(t) ? -Infinity : t
}

const groups = computed(() => {
  const sorted = [...bookmarks.value].sort((a, b) => timeOf(b) - timeOf(a))
  const out: { key: string; label: string; items: UserShareCollectListItem[] }[] = []
  const index = new Map<string, number>()
  for (const item of sorted) {
    const raw = starTime(item)
    const d = raw ? new Date(raw) : null
    const key = d && !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${d.getMonth() + 1}` : '_'
    let idx = index.get(key)
    if (idx === undefined) {
      idx = out.length
      index.set(key, idx)
      out.push({ key, label: monthLabel(d), items: [] })
    }
    out[idx]!.items.push(item)
  }
  return out
})

// ── 分享 popover ──
const shareOpen = ref(false)
const shareMenuRef = ref<HTMLElement>()

// 匿名也能触发，故走自家 nitro 端点
// keepalive：复制链接后切走，请求不能被取消
const trackCollection = (event: 'collection_share' | 'collection_visit', extra?: Record<string, unknown>) => {
  fetch('/api/collection/track', {
    method: 'POST',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event, code: collectionCode, ...extra })
  }).catch(() => {})
}

const copyShareLink = async () => {
  try {
    await copyText(window.location.href)
    Toast.showToast({ text: t('page.c_index.toast_copied') })
    // 只埋复制链接，不埋 shareToTwitter
    trackCollection('collection_share')
  } catch {
    Toast.showToast({ text: t('common.tips.operate_failed'), type: ToastType.Error })
  }
  shareOpen.value = false
}

const shareToTwitter = () => {
  window.open(`https://x.com/intent/tweet?url=${encodeURIComponent(window.location.href)}`, '_blank', 'noopener,noreferrer')
  shareOpen.value = false
}

const onDocClick = (e: MouseEvent) => {
  if (shareOpen.value && shareMenuRef.value && !shareMenuRef.value.contains(e.target as Node)) shareOpen.value = false
}
const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') shareOpen.value = false
}

const goManage = () => navigateTo('/collection/manage?from=collection')

const unsubscribeFromClosed = async () => {
  try {
    await request().post({ url: RESTMethodPath.COLLECT_UNSUBSCRIBE, body: { collect_code: collectionCode }, errorInterceptors: () => {} })
    Toast.showToast({ text: t('page.c_index.toast_unsubscribed') })
    // 写成功即权威，勿回读缓存旧值
    onSubscribeUpdate(false)
  } catch {
    Toast.showToast({ text: t('common.tips.operate_failed'), type: ToastType.Error })
  }
}

// ── SEO（§8） ──
const defineSeo = () => {
  const setStatus404 = () => {
    if (import.meta.server) {
      const ev = useRequestEvent()
      if (ev) setResponseStatus(ev, 404)
    }
  }

  // 不存在→404+noindex
  if (notFound.value) {
    setStatus404()
    useRobotsRule('noindex, follow')
    useHead({ title: `${t('page.c_index.not_found_title')} - ${t('common.app.name')}` })
    return
  }

  // title/description，缺省自动生成
  const title = `${displayTitle.value} - ${t('common.app.name')}`
  const buildFallbackDesc = () => {
    let desc = t('page.c_index.seo_desc_fallback', { name: ownerName.value, count: articleCount.value })
    const updatedAt = info.value?.updated_at ? new Date(info.value.updated_at) : null
    const month = monthLabel(updatedAt)
    if (month) desc += t('page.c_index.seo_desc_updated', { month })
    return desc
  }
  const description = info.value?.description || buildFallbackDesc()

  // 关闭态：404+noindex
  if (isClosed.value) {
    setStatus404()
    useRobotsRule('noindex, follow')
    useHead({ title })
    useSeoMeta({ title, description, ogType: 'website', ogTitle: displayTitle.value, ogDescription: description, ogSiteName: t('common.app.name') })
    return
  }

  // 开启态：完整 meta+canonical+schema
  const requestUrl = useRequestURL()
  const basePath = `${requestUrl.origin}${requestUrl.pathname}`
  // page>1 带 ?page=N
  const pageUrl = (p: number) => (p > 1 ? `${basePath}?page=${p}` : basePath)
  // getter 随 page 响应式更新
  useHead(() => {
    // prev/next 顺链可爬
    type NavLink = { rel: 'canonical'; href: string } | { rel: 'prev'; href: string } | { rel: 'next'; href: string }
    const links: NavLink[] = [{ rel: 'canonical', href: pageUrl(page.value) }]
    if (page.value > 1) links.push({ rel: 'prev', href: pageUrl(page.value - 1) })
    if (page.value < totalPages.value) links.push({ rel: 'next', href: pageUrl(page.value + 1) })
    return { title, link: links }
  })
  useSeoMeta({
    title,
    description,
    ogType: 'website',
    ogTitle: displayTitle.value,
    ogDescription: description,
    ogUrl: () => pageUrl(page.value),
    ogSiteName: t('common.app.name')
  })
  // ItemList：让搜索引擎识别为条目集合
  const itemListElement = bookmarks.value
    .map((bm, i) => {
      const url = bm.bookmark_uuid ? `${requestUrl.origin}/b/${bm.bookmark_uuid}` : ''
      if (!url) return null
      return { '@type': 'ListItem', position: (page.value - 1) * PAGE_SIZE + i + 1, url, name: bm.title || bm.alias_title || url }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
  useSchemaOrg([
    defineWebPage({
      '@type': 'CollectionPage',
      name: displayTitle.value,
      description
    }),
    defineItemList({ itemListElement })
  ])
}

defineSeo()

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKeydown)
  checkSubscribed()
  handleStripeReturn()
  // SPA 跳转进入才补埋；SSR 进入已由 nitro plugin 记过，补了就是重复计数。
  // is_curator / entry_page 服务端在这条通道上拿不到（不做 DB 往返、SPA 没进过服务端），只能由页面申报
  if (!isSsrEntry) trackCollection('collection_visit', { is_curator: isOwner.value, entry_page: page.value })

  // 埋点：collection_opened
  const openedFrom = consumeEventEntry(['external_link', 'inbox'] as const, 'external_link')
  eventLog({
    event_name: 'collection_opened',
    properties: { collection_id: collectionCode, opened_from: openedFrom }
  })
})

// Stripe 结账回跳：/c/{code}?status=success|cancel（付费订阅走支付流程后回来）
const handleStripeReturn = () => {
  const status = useRoute().query.status
  if (status !== 'success' && status !== 'cancel') return
  // 支付成功→提示；订阅态由 checkSubscribed 刷新（webhook 落库或有短延迟）
  if (status === 'success') Toast.showToast({ text: t('page.c_index.toast_subscribed'), type: ToastType.Success })
  // 清 URL status，避免刷新重复提示
  const url = new URL(window.location.href)
  url.searchParams.delete('status')
  window.history.replaceState(window.history.state, '', url.toString())
}

onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<style lang="scss" scoped>
.collection-page {
  --style: w-full relative;
  min-height: 100vh;
}

// ── 顶栏 ──
.cp-topbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 56px;
  background: var(--slax-topbar-bg);
  backdrop-filter: var(--slax-blur);
  border-bottom: 1px solid var(--slax-border);
  z-index: 100;
}

.cp-topbar-inner {
  max-width: 820px;
  margin: 0 auto;
  padding: 0 24px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 24px;

  @media (max-width: 760px) {
    padding: 0 16px;
  }
}

// logo + 主题切换成组
.cp-topbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cp-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--slax-text);
  font-family: var(--slax-font-serif);
  font-size: var(--slax-fs-brand);
  font-weight: 500;

  img {
    display: block;
    flex-shrink: 0;
  }

  @media (max-width: 420px) {
    .cp-logo-text {
      display: none;
    }
  }
}

.cp-shell {
  max-width: 820px;
  min-height: 100vh;
  margin: 0 auto;
  padding: 56px 24px 88px;

  @media (max-width: 760px) {
    padding: 52px 16px 72px;
  }
}

.cp-loading {
  --style: flex-center;
  min-height: 60vh;
}

// ── Hero ──
.cp-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 32px;
  align-items: end;
  // cp-note 占位，底距恒定
  padding: 56px 4px 40px;
  border-bottom: 1px solid var(--slax-border);

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
    column-gap: 0;
    align-items: start;
    padding: 44px 0 40px;
  }

  &.has-subscription-note {
    padding-bottom: 16px;

    @media (max-width: 760px) {
      padding-bottom: 16px;
    }
  }
}

.cp-copy {
  grid-column: 1;
  grid-row: 1;
}

.cp-badge {
  display: inline-flex;
  align-items: center;
  margin-bottom: 16px;
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--slax-accent-bg);
  color: var(--slax-accent);
  font-size: 12px;
  line-height: 1.5;
}

.cp-title {
  max-width: 720px;
  color: var(--slax-text);
  font-family: var(--slax-font-serif);
  font-size: 32px;
  font-weight: 500;
  line-height: 1.12;

  @media (max-width: 760px) {
    line-height: 1.18;
  }
}

.cp-desc {
  max-width: 680px;
  margin-top: 18px;
  color: var(--slax-text-muted);
  font-size: 14px;
  font-weight: 300;
  line-height: 1.8;

  @media (max-width: 760px) {
    margin-top: 14px;
    line-height: 1.75;
  }
}

.cp-stats {
  display: flex;
  align-items: center;
  gap: 28px;
  margin-top: 28px;
  flex-wrap: wrap;

  @media (max-width: 760px) {
    margin-top: 24px;
    gap: 24px;
  }
}

.cp-stat {
  display: grid;
  gap: 5px;
}

.cp-stat-value {
  color: var(--slax-text);
  font-family: var(--slax-font-serif);
  font-size: 22px;
  font-weight: 500;
  line-height: 1;
}

.cp-stat-label {
  color: var(--slax-text-light);
  font-size: 12px;
  line-height: 1;
}

.cp-note {
  grid-column: 1;
  grid-row: 2;
  margin-top: 40px;
  color: var(--slax-text-light);
  font-size: 13px;
  line-height: 1.6;

  // 隐藏保留高度防跳动
  &.is-invisible {
    display: none;
  }

  @media (max-width: 760px) {
    grid-row: 3;
    margin-top: 18px;
    white-space: normal;
  }
}

.cp-note-link {
  color: var(--slax-accent);
  font-weight: 500;
  text-decoration: none;

  &:hover {
    opacity: 0.9;
  }
}

.cp-note-divider {
  display: inline-block;
  width: 1px;
  height: 12px;
  margin: 0 12px;
  background: var(--slax-border);
  vertical-align: -1px;
}

// 判定前骨架占位，防闪现
.cp-skeleton {
  display: inline-block;
  border-radius: var(--slax-radius-sm);
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--slax-border) 75%, transparent) 25%,
    color-mix(in srgb, var(--slax-border) 32%, transparent) 37%,
    color-mix(in srgb, var(--slax-border) 75%, transparent) 63%
  );
  background-size: 400% 100%;
  animation: cp-skeleton-shimmer 1.4s ease infinite;
}

@keyframes cp-skeleton-shimmer {
  0% {
    background-position: 100% 50%;
  }

  100% {
    background-position: 0 50%;
  }
}

.cp-note-skeleton {
  width: min(280px, 60%);
  height: 13px;
  vertical-align: middle;
}

.cp-action-skeleton {
  width: 120px;
  height: 40px;
}

// 骨架→内容：淡出再淡入
.cp-note-body {
  // inline-block 才能吃 transform
  display: inline-block;
  max-width: 100%;
  vertical-align: middle;
}

.cp-fade-enter-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.cp-fade-leave-active {
  transition:
    opacity 0.1s ease,
    transform 0.1s ease;
}

// 离场须关骨架 shimmer，
// 否则 Transition 卡 ~1.4s
.cp-skeleton.cp-fade-leave-active {
  animation: none;
}

.cp-fade-enter-from {
  opacity: 0;
  transform: translateY(3px);
}

.cp-fade-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}

@media (prefers-reduced-motion: reduce) {
  .cp-skeleton {
    animation: none;
  }

  .cp-fade-enter-active,
  .cp-fade-leave-active {
    transition: none;
  }

  .cp-fade-enter-from,
  .cp-fade-leave-to {
    transform: none;
  }
}

.cp-actions {
  grid-column: 2;
  grid-row: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
  padding-bottom: 2px;

  @media (max-width: 760px) {
    grid-column: 1;
    grid-row: 2;
    justify-content: flex-start;
    width: 100%;
    margin-top: 24px;
  }
}

// 分享 popover
.cp-popover-menu {
  position: relative;
}

.cp-icon-btn {
  width: 40px;
  min-width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  background: transparent;
  color: color-mix(in srgb, var(--slax-text) 58%, var(--slax-text-muted));
  cursor: pointer;
  transition: all var(--slax-dur-fast) ease;

  &:hover {
    background: var(--slax-accent-bg);
    border-color: var(--slax-accent-soft);
    color: var(--slax-accent);
  }

  svg {
    width: 16px;
    height: 16px;
  }
}

.cp-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 188px;
  padding: 6px;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  background: var(--slax-surface-solid);
  box-shadow: var(--slax-shadow-warm);
  opacity: 0;
  pointer-events: none;
  transform: translateY(-4px);
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
  z-index: 200;

  .cp-popover-menu.open & {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }
}

.cp-popover-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 9px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--slax-text-muted);
  cursor: pointer;
  font-size: 14px;
  text-align: left;
  transition: all 0.12s;

  &:hover {
    background: var(--slax-accent-bg);
    color: var(--slax-text);
  }

  svg {
    width: 16px;
    height: 16px;
    opacity: 0.75;
    flex-shrink: 0;
  }
}

.cp-manage-btn {
  min-height: 40px;
  min-width: 88px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 16px;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  background: transparent;
  color: color-mix(in srgb, var(--slax-text) 58%, var(--slax-text-muted));
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  white-space: nowrap;
  transition: all var(--slax-dur-fast) ease;

  &:hover {
    background: var(--slax-accent-bg);
    border-color: var(--slax-accent-soft);
    color: var(--slax-accent);
  }
}

// ── 文章列表 ──
.cp-list-section {
  padding-top: 0;
}

.cp-article-list {
  --article-marker-col: 24px;
  --article-marker-gap: 8px;
  --article-marker-size: 6px;
  --article-row-x-padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 0;

  @media (max-width: 768px) {
    --article-marker-col: 18px;
    --article-row-x-padding: 0px;
  }
}

.cp-date-group {
  position: relative;
  margin-top: 48px;
  padding: 0 var(--article-row-x-padding) 16px calc(var(--article-row-x-padding) + var(--article-marker-col) + var(--article-marker-gap));
  color: var(--slax-text-light);
  font-size: 12px;
}

.cp-list-end {
  padding: 48px 0 0;
  color: var(--slax-text-light);
  font-family: var(--slax-font-serif);
  font-size: 13px;
  font-style: italic;
  font-weight: 300;
  text-align: center;
}

// ── 空 / 错误 / 关闭态 ──
.cp-empty-view {
  min-height: calc(100vh - 144px);
  padding: 96px 24px 88px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;

  @media (max-width: 760px) {
    min-height: calc(100vh - 128px);
    padding: 80px 16px 72px;
  }
}

.cp-empty-inline {
  padding: 96px 24px 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.cp-empty-icon {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: var(--slax-surface);
  border: 1px solid var(--slax-border);
  box-shadow: inset 0 1px 0 var(--slax-inset-hi);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--slax-text-light);
  margin-bottom: 24px;

  svg {
    width: 32px;
    height: 32px;
    opacity: 0.7;
  }
}

.cp-empty-title {
  font-family: var(--slax-font-serif);
  font-size: 20px;
  font-weight: 500;
  color: var(--slax-text);
  margin: 0 0 8px;
}

.cp-empty-desc {
  font-size: 14px;
  color: var(--slax-text-light);
  margin: 0;
  line-height: 1.7;
  max-width: 400px;
}

.cp-empty-actions {
  margin-top: 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.cp-cta-btn {
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 16px;
  border: 1px solid var(--slax-accent);
  border-radius: var(--slax-radius-sm);
  background: var(--slax-accent);
  color: var(--slax-btn-text);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  white-space: nowrap;
  transition: all var(--slax-dur-fast) ease;

  &:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }
}
</style>
