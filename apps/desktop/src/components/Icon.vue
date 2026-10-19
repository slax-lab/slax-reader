<script lang="ts">
const paths: Record<string, string> = {
  refresh:
    "M20 7v5h-5 M4 17v-5h5 M6 7a7 7 0 0 1 12-2l2 3 M4 16l2 3a7 7 0 0 0 12-2",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2",
  warning: "m12 3 10 18H2z M12 9v5 M12 17h.01",
  inbox: "M3 4h18v16H3z M3 13h5l2 3h4l2-3h5",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2 7.5 14 3 9.6l6.2-.9z",
  archive: "M3 4h18v4H3z M5 8v12h14V8 M9 12h6",
  plus: "M12 5v14 M5 12h14",
  search: "M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15 M16 16l5 5",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z",
  sidebar: "M3 4h18v16H3z M9 4v16",
  link: "m9 15 6-6 M8 16l-1 1a4 4 0 0 1-5-5l4-4a4 4 0 0 1 5 0 M13 8l1-1a4 4 0 0 1 5 5l-4 4a4 4 0 0 1-5 0",
  more: "M5 12h.01 M12 12h.01 M19 12h.01",
  note: "M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  chevron: "m9 6 6 6-6 6",
  external: "M14 4h6v6 M20 4 11 13 M18 14v6H4V6h6",
  close: "m6 6 12 12 M6 18 18 6",
  check: "m5 12 4 4L19 6",
  download: "M12 3v12 m-5-5 5 5 5-5 M4 17v4h16v-4",
  rss: "M5 19h.01 M4 11a9 9 0 0 1 9 9 M4 4a16 16 0 0 1 16 16",
  book: "M12 5v16 M12 5C7 2 3 3 3 3v16s4-1 9 2c5-3 9-2 9-2V3s-4-1-9 2",
  trash: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
  copy: "M8 8h13v13H8z M16 8V3H3v13h5",
  spark: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z",
  tag: "M3 3h8l10 10-8 8L3 11z M7 7h.01",
  cloud: "M6 18h12a4 4 0 0 0 0-8 6 6 0 0 0-12-1 4.5 4.5 0 0 0 0 9",
};
</script>
<script setup lang="ts">
defineProps<{ name: string; size?: number }>();
</script>
<template>
  <svg
    :width="size ?? 18"
    :height="size ?? 18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] ?? paths.book" />
  </svg>
</template>
