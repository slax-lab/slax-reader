<template>
  <!-- 邀请段内容：由 LoginView 的 invite 插槽包裹于 .invite-section 内，与登录段共用一张卡片 -->
  <div class="koc-invite-content">
    <!-- 头像：挂在卡片顶部边框上方居中 -->
    <div class="invite-avatar-lg" aria-hidden="true">
      <img v-if="bloggerInfo?.avatar" :src="bloggerInfo.avatar" class="invite-avatar-img" alt="" />
      <span v-else-if="inviterInitial">{{ inviterInitial }}</span>
      <svg v-else width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.582-7 8-7s8 3 8 7" />
      </svg>
    </div>

    <p class="invite-line">
      <template v-if="bloggerInfo?.name">
        <span class="inviter">{{ bloggerInfo.name }}</span> {{ $t('component.login_koc_banner.invited_by') }} <span class="product">{{ $t('common.app.name') }}</span>
      </template>
      <template v-else> {{ $t('component.login_koc_banner.invited_generic') }} <span class="product">{{ $t('common.app.name') }}</span> </template>
    </p>

    <span class="invite-perk">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
      {{ $t('component.login_koc_banner.perk') }}
    </span>
  </div>
</template>

<script lang="ts" setup>
interface BloggerInfo {
  name?: string
  avatar?: string
  activity_id?: string
}

const props = defineProps<{ bloggerInfo?: BloggerInfo | null }>()

// 取名字首个「字素簇」：英文取首字母、中文取首字、emoji 取完整首个表情（含旗帜/ZWJ 组合序列）。
// charAt(0) 按 UTF-16 码元切分会把 emoji 的代理对截断成乱码，故用 Intl.Segmenter，
// 不可用时（如部分 Workers 运行时）退化为按码点切分的 Array.from。
const firstGrapheme = (raw: string): string => {
  const s = raw.trim()
  if (!s) return ''
  if (typeof Intl !== 'undefined' && typeof (Intl as { Segmenter?: unknown }).Segmenter === 'function') {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    return seg.segment(s)[Symbol.iterator]().next().value?.segment ?? ''
  }
  return Array.from(s)[0] ?? ''
}

// toUpperCase 对中文/emoji 是无操作，仅把英文首字母转大写
const inviterInitial = computed(() => firstGrapheme(props.bloggerInfo?.name ?? '').toUpperCase())
</script>

<style lang="scss" scoped>
.koc-invite-content {
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* 头像：挂在卡片顶部边框上方居中 */
.invite-avatar-lg {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--slax-accent-bg);
  border: 5px solid var(--slax-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: 600;
  color: var(--slax-accent);
  overflow: hidden;
  margin: 0 auto -8px;
  position: relative;
  top: -28px;
  box-shadow:
    0 0 0 1px var(--slax-accent-soft),
    var(--slax-shadow-sm);
  z-index: 10;
}

.invite-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.invite-line {
  font-size: 14px;
  line-height: 1.55;
  color: var(--slax-text);
  margin: 0 0 12px;

  .inviter {
    color: var(--slax-accent);
    font-weight: 500;
  }

  .product {
    font-weight: 600;
    color: var(--slax-text);
  }
}

.invite-perk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--slax-accent-bg);
  border: 1px solid color-mix(in srgb, var(--slax-accent) 20%, transparent);
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  color: var(--slax-accent);

  svg {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
  }
}
</style>
