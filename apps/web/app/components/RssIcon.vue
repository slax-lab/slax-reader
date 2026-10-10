<template>
  <AppIcon :name="iconKeys[name]" :size="20" v-bind="$attrs" />
</template>
<script setup lang="ts">
import AppIcon from '~/components/AppIcon.vue'

defineOptions({ inheritAttrs: false })

const iconKeys = {
  rss: 'rss.rss',
  plus: 'rss.plus',
  back: 'rss.back',
  bookmark: 'rss.bookmark',
  check: 'rss.check',
  refresh: 'rss.refresh',
  close: 'rss.close',
  edit: 'rss.edit',
  trash: 'rss.trash',
  external: 'rss.external',
  inbox: 'rss.inbox'
} as const

defineProps<{ name: keyof typeof iconKeys }>()
</script>
