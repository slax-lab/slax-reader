<template>
  <!-- 收起态只占「已订阅」宽度，hover 展开分隔线+退订 -->
  <button v-if="subscribed" class="collection-action-btn is-subscriber" :class="{ loading: busy }" type="button" :aria-label="$t('page.c_index.unsubscribe')" @click="unsubscribe">
    <span class="cab-content" :class="{ 'is-hidden': busy }">
      <span class="primary-text">{{ $t('page.c_index.subscribed') }}</span>
      <span class="action-divider" aria-hidden="true"></span>
      <span class="secondary-text">{{ $t('page.c_index.unsubscribe') }}</span>
    </span>
    <div v-if="busy" class="cab-spinner i-svg-spinners:90-ring text-20px" aria-hidden="true" style="color: var(--slax-accent)"></div>
  </button>
  <!-- Visitor：订阅合集 -->
  <button v-else class="collection-action-btn is-visitor" :class="{ loading: busy }" type="button" @click="subscribe">
    <span v-if="!busy">{{ $t('page.c_index.subscribe') }}</span>
    <div v-else class="i-svg-spinners:90-ring text-20px" style="color: var(--slax-btn-text)"></div>
  </button>
</template>

<script setup lang="ts">
import { RESTMethodPath } from '@commons/contracts/const'
import { showLoginModal } from '~/components/Modal'
import Toast, { ToastType } from '~/components/Toast'
import { useUserStore } from '~/stores/user'

const props = defineProps({
  collectionCode: {
    type: String,
    required: true
  },
  subscribed: {
    type: Boolean,
    required: true
  }
})

// 携带写结果，父级乐观置态
const emits = defineEmits<{ update: [subscribed: boolean] }>()

const { t } = useI18n()
const userStore = useUserStore()

const busy = ref(false)
// setup 即取，避免 mount 前拿到空 base
const redirectHref = ref(useRequestURL().href)

// 写成功后压 1s：后端异步，
// 期间保持 busy，防秒点
const SETTLE_DELAY = 1000
const settle = () => new Promise(resolve => setTimeout(resolve, SETTLE_DELAY))

// 回跳自动订阅（query+storage）
const PENDING_KEY = 'slax_subscribe_after_login'

// 只取 origin + pathname，query 可能带 token
// 同源值照记，算站内入口信号
const safeReferrer = (raw: string) => {
  if (!raw) return ''
  try {
    const url = new URL(raw)
    return `${url.origin}${url.pathname}`.slice(0, 512)
  } catch {
    return ''
  }
}

const doSubscribe = async (referrer?: string) => {
  if (busy.value) return
  busy.value = true
  try {
    // 付费合集(amount>0)后端返回 payment_link+subscribe:false，需跳 Stripe 结账
    const res = await request().post<{ payment_link?: string; subscribe: boolean }>({
      url: RESTMethodPath.COLLECT_SUBSCRIBE,
      body: { collect_code: props.collectionCode, referrer: referrer || undefined }
    })
    // 免费直通（幂等）
    if (res?.subscribe) {
      await settle()
      Toast.showToast({ text: t('page.c_index.toast_subscribed'), type: ToastType.Success })
      // 写成功即权威，勿回读缓存
      emits('update', true)
      // 跳 Inbox，nc 标记新订阅供入场动画
      await navigateTo({ path: '/bookmarks', query: { filter: 'inbox', nc: props.collectionCode } })
    } else if (res?.payment_link) {
      // 付费：整页跳转 Stripe，支付后回跳 /c/{code}?status=success
      window.location.href = res.payment_link
    } else {
      Toast.showToast({ text: t('common.tips.operate_failed'), type: ToastType.Error })
    }
  } catch {
    Toast.showToast({ text: t('common.tips.operate_failed'), type: ToastType.Error })
  } finally {
    busy.value = false
  }
}

const subscribe = async () => {
  const referrer = safeReferrer(document.referrer)
  // 未登录 getUserInfo 抛错→引导登录
  const user = await userStore.getUserInfo().catch(() => null)
  if (!user) {
    // 落标记+弹登录，回跳自动订阅。
    // referrer 一并存起来：OAuth 回跳后 document.referrer 是 OAuth 提供商，原始来源已经丢了
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ code: props.collectionCode, referrer }))
    } catch {}
    const sep = redirectHref.value.includes('?') ? '&' : '?'
    showLoginModal({ redirect: `${redirectHref.value}${sep}subscribe_after_login=1` })
    return
  }
  await doSubscribe(referrer)
}

const unsubscribe = async () => {
  if (busy.value) return
  busy.value = true
  try {
    // 退订常空 body，未抛错即成功
    await request().post({
      url: RESTMethodPath.COLLECT_UNSUBSCRIBE,
      body: { collect_code: props.collectionCode }
    })
    await settle()
    Toast.showToast({ text: t('page.c_index.toast_unsubscribed'), type: ToastType.Success })
    // 退订同理
    emits('update', false)
  } catch {
    Toast.showToast({ text: t('common.tips.operate_failed'), type: ToastType.Error })
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  // 回跳自动订阅一次
  if (props.subscribed) return
  let raw = ''
  try {
    raw = sessionStorage.getItem(PENDING_KEY) || ''
  } catch {}
  // 值从裸 code 升级成 JSON({ code, referrer })；解析失败回退成裸 code，兼容上线前写入的旧值
  let pending = raw
  let pendingReferrer = ''
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as { code?: string; referrer?: string }
      pending = parsed.code || ''
      pendingReferrer = parsed.referrer || ''
    } catch {
      pending = ''
    }
  }
  const queryFlag = useRoute().query.subscribe_after_login === '1'
  // 先清 URL flag，防他人被动订阅
  if (queryFlag && import.meta.client) {
    const url = new URL(window.location.href)
    url.searchParams.delete('subscribe_after_login')
    window.history.replaceState(window.history.state, '', url.toString())
  }
  // 仅本人发起（storage 标记命中）才自动订阅
  if (pending === props.collectionCode && userStore.userInfo) {
    try {
      sessionStorage.removeItem(PENDING_KEY)
    } catch {}
    doSubscribe(pendingReferrer)
  }
})

defineExpose({ subscribe })
</script>

<style lang="scss" scoped>
.collection-action-btn {
  min-height: 40px;
  min-width: 88px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
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

  &.loading {
    pointer-events: none;
  }

  // Visitor：accent 实心
  &.is-visitor {
    background: var(--slax-accent);
    border-color: var(--slax-accent);
    color: var(--slax-btn-text);

    &:hover {
      opacity: 0.9;
      transform: translateY(-1px);
    }

    &:active {
      opacity: 0.8;
      transform: scale(0.98);
    }
  }

  // Subscriber：收起态只占「已订阅」，hover 撑开
  &.is-subscriber {
    position: relative;
    gap: 0;
    padding: 0 14px;
    overflow: hidden;

    .cab-content {
      display: inline-flex;
      align-items: center;
      white-space: nowrap;
      transition: opacity var(--slax-dur-fast) ease;

      &.is-hidden {
        opacity: 0;
      }
    }

    .cab-spinner {
      position: absolute;
      inset: 0;
      margin: auto;
    }

    .primary-text {
      color: var(--slax-text-muted);
    }

    // 分隔线收起时零宽零边距
    .action-divider {
      width: 0;
      height: 12px;
      margin: 0;
      background: var(--slax-border);
      flex-shrink: 0;
      opacity: 0;
      overflow: hidden;
      transition:
        width var(--slax-dur-fast) ease,
        margin var(--slax-dur-fast) ease,
        opacity var(--slax-dur-fast) ease;
    }

    // 跟随按钮 hover 色（accent）
    .secondary-text {
      max-width: 0;
      color: inherit;
      opacity: 0;
      overflow: hidden;
      transform: translateX(-4px);
      transition:
        max-width var(--slax-dur-fast) ease,
        opacity var(--slax-dur-fast) ease,
        transform var(--slax-dur-fast) ease;
    }

    &:hover,
    &:focus-visible {
      background: var(--slax-accent-bg);
      border-color: var(--slax-accent-soft);
      color: var(--slax-accent);

      .action-divider {
        width: 1px;
        margin-left: 8px;
        margin-right: 8px;
        opacity: 1;
      }

      .secondary-text {
        // 原型按中文 2em；此处留足余量兼容其他语种（如 Unsubscribe）
        max-width: 8em;
        opacity: 1;
        transform: translateX(0);
      }
    }
  }
}
</style>
