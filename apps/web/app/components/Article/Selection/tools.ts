// utils.ts
import { useNuxtApp } from '#app'
export const t = (text: string) => useNuxtApp().$i18n.t(text)
export { objectDeepEqual } from '@commons/frontend-utils/object'
export { getUUID } from '@commons/frontend-utils/random'
export { copyText } from '@commons/frontend-utils/string'
