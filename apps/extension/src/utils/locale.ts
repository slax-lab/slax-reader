import { ref } from 'vue'

import { translate } from './localeCore'
import type { AppLocale } from '@commons/frontend-types/locale'
import type { GeneratedI18nStructure } from '#i18n'

const activeLocale = ref<AppLocale>('en')
export const getExtensionLocale = () => activeLocale.value
export const setExtensionLocale = (locale: AppLocale) => {
  activeLocale.value = locale
}
export const $t = (name: keyof GeneratedI18nStructure, params?: string[]) => translate(activeLocale.value, name, params)
