<template>
  <AppLayoutShell>
    <NuxtPwaAssets v-if="showPwaManifest" />
    <NuxtPage :keepalive="{ include: cacheRoutes }" />
    <ClientOnly><KocPromotionHost /></ClientOnly>
    <ClientOnly><InAppBrowserTip /></ClientOnly>
  </AppLayoutShell>
</template>

<script setup lang="ts">
import AppLayoutShell from '~/components/Layouts/AppLayoutShell.vue'
import KocPromotionHost from '~/components/Promotion/KocPromotionHost.vue'
import InAppBrowserTip from '~/components/Tips/InAppBrowserTip.vue'

const cacheRoutes = ['bookmarks']

const route = useRoute()
const showPwaManifest = computed(() => route.path === '/' || route.path === '/bookmarks')
</script>
