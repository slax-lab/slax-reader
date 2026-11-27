<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'

import { $t } from '@/utils/locale'

import { fitNotificationSubject } from './notificationSubject'
import type { PopupNotification } from '@commons/frontend-types/frontend'
import { useElementSize } from '@vueuse/core'

const props = defineProps<{ item: PopupNotification }>()
const label = useTemplateRef<HTMLSpanElement>('label')
const measure = useTemplateRef<HTMLSpanElement>('measure')
const measuredSubject = useTemplateRef<HTMLSpanElement>('measuredSubject')
const { width } = useElementSize(label)

const quote = (value: string) => `「${value}」`
const text = computed(() => {
  const isSave = props.item.kind === 'save'
  const sentence = $t(isSave ? 'action_popup.saved_subject' : 'action_popup.new_content_subject', ['$1'])
  const [prefix, suffix] = sentence.split(quote('$1'))
  return { prefix, suffix, fallback: $t(isSave ? 'action_popup.saved' : 'action_popup.new_content') }
})

const subject = computed(() => props.item.title.trim().replace(/\s+/g, ' '))
const fullText = computed(() => subject.value ? text.value.prefix + quote(subject.value) + text.value.suffix : text.value.fallback)
const visibleSubject = ref(subject.value)

watch([width, subject, text, measure, measuredSubject], ([available, title, , probe, probeSubject]) => {
  if (!available || !title || !probe || !probeSubject) {
    visibleSubject.value = title
    return
  }
  visibleSubject.value = fitNotificationSubject(title, candidate => {
    probeSubject.textContent = quote(candidate)
    return probe.getBoundingClientRect().width <= available
  })
}, { flush: 'post', immediate: true })
</script>

<template>
  <span ref="label" class="notification-copy" :title="fullText">
    <span class="sr-only">{{ fullText }}</span>
    <span v-if="subject" class="notification-label" aria-hidden="true">
      <span v-if="text.prefix" class="notification-status">{{ text.prefix }}</span>
      <span class="notification-subject">{{ quote(visibleSubject) }}</span>
      <span class="notification-status">{{ text.suffix }}</span>
    </span>
    <span v-else class="notification-label notification-status" aria-hidden="true">{{ text.fallback }}</span>
    <span v-if="subject" ref="measure" class="notification-measure" aria-hidden="true">
      <span v-if="text.prefix">{{ text.prefix }}</span>
      <span ref="measuredSubject" class="notification-subject" />
      <span>{{ text.suffix }}</span>
    </span>
  </span>
</template>

<style scoped>
.notification-copy {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.notification-measure {
  position: absolute;
  inline-size: max-content;
  visibility: hidden;
  pointer-events: none;
}

.notification-subject {
  font-weight: 600;
}

.notification-status {
  color: var(--popup-text-muted);
}
</style>
