<template>
  <BookmarksPage />
</template>

<script setup lang="ts">
definePageMeta({ alias: ['/'], key: 'bookmarks' })
defineOptions({ name: 'bookmarks' })

const BookmarksPage = defineAsyncComponent(() => import('~/components/BookmarkList/BookmarksPage.vue'))
</script>
