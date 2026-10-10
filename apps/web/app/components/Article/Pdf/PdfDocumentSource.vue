<template>
  <SnapshotArticleSource v-if="pdf.source === 'url' && url" class="pdf-source-link"
    :url="url" :site-name="siteName" :host-url="hostUrl" :author="author" />
  <div v-else class="pdf-upload-source">
    <span class="pdf-source-label">{{ t('component.snapshot_article_source.label') }}</span>
    <span class="pdf-source-label">{{ pdf.source === 'upload' ? t('pdf.local_upload') : pdf.filename }}</span>
    <span v-if="pdf.source === 'upload'" class="pdf-source-name" :title="pdf.filename">{{ pdf.filename }}</span>
    <span v-if="author?.trim()" aria-hidden="true">·</span>
    <span v-if="author?.trim()" class="pdf-source-author" :title="author">{{ author }}</span>
  </div>
</template>

<script setup lang="ts">
import type { PdfDescriptor } from '@slax-reader/contracts/pdf'
import SnapshotArticleSource from '../../Snapshot/SnapshotArticleSource.vue'

defineProps<{
  pdf: Pick<PdfDescriptor, 'source' | 'filename'>
  url?: string
  siteName?: string
  hostUrl?: string
  author?: string
}>()
const { t } = useI18n()
</script>

<style scoped>
.pdf-upload-source {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 3px 10px;
  font-size: var(--slax-fs-aux);
  color: var(--slax-text-muted);
  background: var(--slax-accent-bg);
  border-radius: var(--slax-radius-sm);
}
.pdf-source-label { flex-shrink: 0; }
.pdf-source-name, .pdf-source-author {
  color: var(--slax-accent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
@media (max-width: 768px) {
  .pdf-source-link { min-height: 44px; max-width: 100%; }
}
</style>
