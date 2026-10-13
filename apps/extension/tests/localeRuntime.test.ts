import { computed, effect, stop } from 'vue'

import { $t, getExtensionLocale, setExtensionLocale } from '../src/utils/locale'

import en from '../src/locales/en.json'
import zh from '../src/locales/zh_CN.json'
import { expect, it } from 'vitest'
it('updates all reactive consumers without remounting them', () => {
  setExtensionLocale('en')
  const title = computed(() => $t('collect_page'))
  let first = '',
    second = ''
  const a = effect(() => {
    first = title.value
  })
  const b = effect(() => {
    second = $t('collect_page')
  })
  expect(first).toBe(en.collect_page)
  setExtensionLocale('zh')
  expect([first, second, getExtensionLocale()]).toEqual([zh.collect_page, zh.collect_page, 'zh'])
  stop(a)
  stop(b)
})
