<template>
  <footer class="article-footer">
    <div class="article-footer-text" v-if="showVia">
      <!-- 有合集→站内归属入口 -->
      <template v-if="collection">
        <!-- 小屏仅留 From + 合集名 -->
        <span class="article-footer-via"
          >{{ $t('page.bookmarks_detail.shared_via') }} <strong>{{ via || 'Slax Reader' }}</strong> ·</span
        >
        {{ ' ' }}
        <span class="article-footer-from-full">{{ $t('page.bookmarks_detail.from_collection') }}</span
        ><span class="article-footer-from-short">{{ $t('page.bookmarks_detail.from_collection_short') }}</span>
        <NuxtLink class="article-footer-link article-footer-link--collection" :to="`/c/${collection.code}`">{{ collection.name }} →</NuxtLink>
      </template>
      <!-- 无归属→署名 + Try free -->
      <template v-else>
        {{ $t('page.bookmarks_detail.shared_via') }}
        <strong>{{ via || 'Slax Reader' }}</strong>
        · <a class="article-footer-link" href="https://slax.com/reader/" target="_blank" rel="noopener noreferrer">{{ $t('page.bookmarks_detail.try_free') }}</a>
      </template>
    </div>
    <div class="article-footer-share">
      <span class="article-footer-share-label">{{ $t('common.operate.share') }}：</span>
      <button class="article-footer-share-btn" :title="$t('common.operate.copy_link')" @click="copyLink">
        <svg viewBox="0 0 16 16" fill="none" stroke-width="1">
          <g transform="translate(2, 2)" stroke="currentColor">
            <path
              d="M5,3.667 L10,3.667 C10.736,3.667 11.333,4.264 11.333,5 L11.333,10 C11.333,10.736 10.736,11.333 10,11.333 L5,11.333 C4.264,11.333 3.667,10.736 3.667,10 L3.667,5 C3.667,4.264 4.264,3.667 5,3.667 Z"
            />
            <path d="M2,7.667 L1.333,7.667 C0.597,7.667 0,7.07 0,6.333 L0,1.333 C0,0.597 0.597,0 1.333,0 L6.333,0 C7.07,0 7.667,0.597 7.667,1.333 L7.667,2" />
          </g>
        </svg>
        <!-- 复制成功就近气泡提示 -->
        <span v-if="copied" class="article-footer-copied-tip">{{ $t('component.share_modal.copy_success') }}</span>
      </button>
      <button class="article-footer-share-btn" :title="$t('page.bookmarks_detail.share_to_twitter')" @click="shareToTwitter">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </button>
    </div>
  </footer>
</template>

<script lang="ts" setup>
import Toast, { ToastType } from '~/components/Toast'

withDefaults(
  defineProps<{
    via?: string
    // 左侧「Shared via …」署名段是否展示；owner 看自己的快照时不需要，传 false 隐藏
    showVia?: boolean
    // 所属开启中合集
    collection?: { name: string; code: string } | null
  }>(),
  { showVia: true }
)

const { t } = useI18n()

// 成功就近气泡(1.5s)，失败走 Toast
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

const copyLink = async () => {
  try {
    await navigator.clipboard.writeText(window.location.href)
    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    Toast.showToast({ text: t('common.tips.operate_failed'), type: ToastType.Error })
  }
}

const shareToTwitter = () => {
  const url = `https://x.com/intent/tweet?url=${encodeURIComponent(window.location.href)}`
  window.open(url, '_blank', 'noopener,noreferrer')
}
</script>

<style lang="scss" scoped>
.article-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 56px;
  padding: 20px 0 120px;
  border-top: 1px solid var(--slax-border);
  flex-wrap: wrap;

  @media (max-width: 768px) {
    padding-bottom: 100px;
  }

  .article-footer-text {
    font-size: 13px;
    color: var(--slax-text-light);
    font-weight: 300;

    strong {
      // 对齐 demo：继承正文色与字重
      color: inherit;
      font-weight: inherit;
    }

    .article-footer-link {
      // Try free：muted / 300
      color: var(--slax-text-muted);
      text-decoration: none;
      font-weight: 300;
      margin-left: 4px;

      &:hover {
        text-decoration: underline;
      }

      // 合集入口高亮：accent / 500
      &--collection {
        color: var(--slax-accent);
        font-weight: 500;
      }
    }

    .article-footer-from-short {
      display: none;
    }

    @media (max-width: 768px) {
      .article-footer-via,
      .article-footer-from-full {
        display: none;
      }

      .article-footer-from-short {
        display: inline;
      }
    }
  }

  .article-footer-share {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--slax-text-light);
  }

  .article-footer-share-label {
    margin-right: 4px;
  }

  .article-footer-share-btn {
    position: relative;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid var(--slax-border);
    border-radius: var(--slax-radius-sm);
    color: var(--slax-text-muted);
    cursor: pointer;
    transition: all var(--slax-dur-fast) ease;

    &:hover {
      border-color: var(--slax-accent-soft);
      color: var(--slax-accent);
      background: var(--slax-accent-bg);
    }

    svg {
      width: 14px;
      height: 14px;
    }

    // 复制成功气泡
    .article-footer-copied-tip {
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      margin-bottom: 6px;
      font-size: 11px;
      color: var(--slax-accent);
      background: var(--slax-surface-solid);
      border: 1px solid color-mix(in srgb, var(--slax-accent) 30%, transparent);
      box-shadow: 0 2px 8px color-mix(in srgb, var(--slax-text) 10%, transparent);
      padding: 2px 8px;
      border-radius: 4px;
      white-space: nowrap;
      pointer-events: none;
    }
  }
}
</style>
