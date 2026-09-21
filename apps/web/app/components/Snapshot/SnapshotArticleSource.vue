<template>
  <a class="article-source" :href="href" target="_blank" rel="noopener noreferrer" :title="url">
    <span class="article-source-label">{{ $t('component.snapshot_article_source.label') }}</span>
    <span class="article-source-name" :title="sourceName">{{ sourceName }}</span>
    <span v-if="authorName" class="article-source-separator">·</span>
    <span v-if="authorName" class="article-source-author" :title="authorName">{{ authorName }}</span>
    <span class="article-source-external" aria-hidden="true">↗</span>
  </a>
</template>

<script lang="ts" setup>
const props = defineProps<{
  url: string
  /** Parsed publication/column name. A future column_name can be passed here with priority. */
  siteName?: string | null
  columnName?: string | null
  author?: string | null
  hostUrl?: string | null
}>()

// 无协议时补 https://
const href = computed(() => {
  const url = props.url?.trim() ?? ''
  if (!url) return url
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
})

const hostname = computed(() => {
  const raw = props.hostUrl?.trim() || props.url?.trim() || ''
  try {
    return new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./i, '')
  } catch {
    return raw
      .replace(/^[a-z][a-z\d+.-]*:\/\//i, '')
      .split('/')[0] ?? ''
      .replace(/^www\./i, '')
  }
})

const isX = computed(() => /(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(hostname.value))

const sourceName = computed(() => {
  // columnName 优先，前向兼容未来的 column 字段
  const parsed = props.columnName?.trim() || props.siteName?.trim()
  if (parsed) return isX.value && /^(twitter|x)$/i.test(parsed) ? 'X' : parsed
  return hostname.value || props.url
})

const authorName = computed(() => {
  if (isX.value) {
    // X 的作者从 URL 提取
    const match = props.url?.match(/(?:x|twitter)\.com\/([^/?#]+)/i)
    const handle = match?.[1] && !/^i$/i.test(match[1]) ? match[1] : ''
    if (handle) return handle.startsWith('@') ? handle : `@${handle}`
  }
  return props.author?.trim() || ''
})
</script>

<style lang="scss" scoped>
.article-source {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: min(100%, 520px);
  width: fit-content;
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 400;
  color: var(--slax-text-muted);
  background: var(--slax-accent-bg);
  border-radius: 20px;
  text-decoration: none;
  transition: all 0.15s;

  &:hover {
    color: var(--slax-accent);
    background: color-mix(in srgb, var(--slax-accent) 10%, transparent);
  }

  .article-source-label {
    flex-shrink: 0;
  }

  .article-source-name,
  .article-source-author {
    color: var(--slax-accent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .article-source-name {
    font-weight: 500;
  }

  .article-source-separator {
    flex-shrink: 0;
    color: var(--slax-text-muted);
  }

  .article-source-external {
    flex-shrink: 0;
    margin-left: 1px;
    color: currentColor;
    font-size: 14px;
    line-height: 1;
  }
}
</style>
