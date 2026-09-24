<template><div /></template>
<script setup lang="ts">
const localePath = useLocalePath()
await navigateTo({ path: localePath('/bookmarks'), query: { view: 'rss' } }, { replace: true })
</script>
