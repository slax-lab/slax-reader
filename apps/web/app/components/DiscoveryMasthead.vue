<template>
  <a class="collection-masthead" :href="href">
    <span class="bookplate" aria-hidden="true">{{ Array.from(name.trim())[0] }}</span>
    <span class="identity">
      <span class="label">{{ $t('page.discovery.collectionLabel') }}</span>
      <strong>{{ name }}</strong>
      <span v-if="description" class="description">{{ description }}</span>
    </span>
    <span class="open" aria-hidden="true">↗</span>
  </a>
</template>

<script setup lang="ts">
defineProps<{ name: string; href: string; description?: string }>()
</script>

<style scoped>
.collection-masthead {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 48px;
  color: inherit;
  text-decoration: none;
}
.bookplate {
  display: grid;
  place-items: center;
  flex: none;
  width: 35px;
  height: 44px;
  border: 1px solid currentColor;
  border-inline-start: 4px double currentColor;
  border-radius: 1px 4px 4px 1px;
  font: 650 22px/1 var(--slax-font-serif);
}
.identity { display: grid; gap: 1px; min-width: 0; }
.label { font: 500 var(--slax-fs-tag)/1.3 var(--slax-font-sans); }
.identity strong { font: 650 clamp(18px, 1.8vw, 24px)/1.25 var(--slax-font-serif); }
.description { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--slax-text-muted); font-size: var(--slax-fs-aux); }
.open { margin-inline-start: auto; align-self: center; }
.collection-masthead:hover strong { text-decoration: underline; text-underline-offset: 4px; }
</style>
