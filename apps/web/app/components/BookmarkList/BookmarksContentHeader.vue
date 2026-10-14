<template>
  <!-- content-header slot 分发：搜索态优先，否则按 filterStatus 展示 话题/合集 头部 -->
  <SearchHeader v-if="searchText" :default-search-text="searchText" @back="emit('back')" @search-status-update="status => emit('search-status-update', status)" />
  <template v-else>
    <TagsHeader
      v-if="filterStatus === 'topics'"
      :select-tag-ids="filterTopicIds"
      :select-tag-name="filterTopicName"
      @select-tag="(ids: string[], name?: string) => emit('select-tag', ids, name)"
      @select-untagged="emit('select-untagged')"
    />
    <CollectionHeader
      v-if="filterStatus === 'collections'"
      :select-collect-id="filterCollectionId"
      :select-collect-name="filterCollectionName"
      @code-update="(code: string) => emit('code-update', code)"
      @select-collect="(info: { id: number; name: string; code: string } | null) => emit('select-collect', info)"
    />
  </template>
</template>

<script setup lang="ts">
import SearchHeader from '~/components/BookmarkList/SearchHeader.vue'
import TagsHeader from '~/components/BookmarkList/TagsHeader.vue'

// CollectionHeader 位于 components/global/，由 Nuxt 自动全局注册，无需显式 import

defineProps<{
  searchText: string
  filterStatus: string
  filterTopicIds: string[]
  filterTopicName: string
  filterCollectionId: number
  filterCollectionName: string
}>()

const emit = defineEmits<{
  back: []
  'search-status-update': [status: boolean]
  'select-tag': [ids: string[], name?: string]
  'select-untagged': []
  'select-collect': [info: { id: number; name: string; code: string } | null]
  'code-update': [code: string]
}>()
</script>
