import { computed } from 'vue'

import { type CollectDisplay, formatCollectDisplay } from '../src/utils/collectStatus'
import { setExtensionLocale } from '../src/utils/locale'

import { expect, it } from 'vitest'
it('updates an active status without changing its raw payload or animation frame', () => {
  const status: CollectDisplay = { kind: 'message', key: 'collection_in_progress' }
  let frame = 2
  const text = computed(() => formatCollectDisplay(status, frame))
  setExtensionLocale('en')
  const en = text.value
  setExtensionLocale('zh')
  expect(text.value).not.toBe(en)
  expect(text.value.endsWith('..')).toBe(true)
  expect(formatCollectDisplay({ kind: 'raw', text: 'Backend error $1' })).toBe('Backend error $1')
  expect(frame).toBe(2)
})
