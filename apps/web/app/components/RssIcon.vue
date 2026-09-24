<template>
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="paths[name]" />
  </svg>
</template>
<script setup lang="ts">
defineProps<{ name: keyof typeof paths }>()
const paths = {
  rss: 'M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16M5 19h.01',
  plus: 'M12 5v14M5 12h14',
  back: 'm10 5-7 7 7 7M3 12h18',
  bookmark: 'M6 4h12v17l-6-4-6 4z',
  check: 'm5 12 4 4L19 6',
  refresh: 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M18 18A8 8 0 0 1 5 15',
  close: 'm6 6 12 12M6 18 18 6',
  edit: 'm16 3 5 5-12 12-6 1 1-6zM14 5l5 5',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  external: 'M14 3h7v7M21 3 10 14M10 3H4v17h17v-6',
  inbox: 'M4 4h16l2 12v4H2v-4zM2 16h6l2 2h4l2-2h6'
} as const
</script>
