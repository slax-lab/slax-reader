<template>
  <component v-if="implementation" :is="implementation" ref="panel" v-bind="$attrs" />
  <div v-else-if="active" class="deferred-panel-status" role="status" aria-live="polite">
    <button v-if="failed" type="button" @click="loadPanel">{{ $t('component.ai_panel.retry') }}</button>
    <span v-else>{{ $t('common.operate.loading') }}</span>
  </div>
</template>

<script setup lang="ts">
import { type Component,onBeforeUnmount, shallowRef, watch } from 'vue'

import type { QuoteData } from '~/components/Chat/type'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  active: boolean
  load: () => Promise<{ default: Component }>
}>()

type ChatActions = { addQuoteData?: (data: QuoteData) => void; focusTextarea?: () => void }
const implementation = shallowRef<Component>()
const panel = shallowRef<ChatActions>()
const failed = shallowRef(false)
let loading = false
let disposed = false
let pendingQuotes: QuoteData[] = []
let pendingFocus = false

async function loadPanel() {
  if (loading || implementation.value || disposed) return
  loading = true
  failed.value = false
  try {
    const loaded = await props.load()
    if (!disposed) implementation.value = loaded.default
  } catch {
    if (!disposed) failed.value = true
  } finally {
    loading = false
  }
}

watch(() => props.active, active => {
  if (active) void loadPanel()
}, { immediate: true })

watch(panel, current => {
  if (!current || disposed) return
  const quotes = pendingQuotes
  pendingQuotes = []
  for (const quote of quotes) current.addQuoteData?.(quote)
  if (pendingFocus) {
    pendingFocus = false
    current.focusTextarea?.()
  }
}, { flush: 'post' })

function addQuoteData(data: QuoteData) {
  if (disposed) return
  if (panel.value) panel.value.addQuoteData?.(data)
  else pendingQuotes.push(data)
}

function focusTextarea() {
  if (disposed) return
  if (panel.value) panel.value.focusTextarea?.()
  else pendingFocus = true
}

onBeforeUnmount(() => {
  disposed = true
  pendingQuotes = []
  pendingFocus = false
})

defineExpose({ addQuoteData, focusTextarea })
</script>

<style scoped>
.deferred-panel-status {
  padding: 24px;
  color: var(--slax-text-muted);
}
.deferred-panel-status button {
  color: var(--slax-text);
  text-decoration: underline;
}
</style>
