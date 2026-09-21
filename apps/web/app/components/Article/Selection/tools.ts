// utils.ts
import { useNuxtApp } from '#app'
export const t = (text: string) => useNuxtApp().$i18n.t(text)
export { objectDeepEqual } from '@commons/utils/object'
export { getUUID } from '@commons/utils/random'
export { copyText } from '@commons/utils/string'
