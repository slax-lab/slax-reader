import type { GeneratedI18nStructure } from '#i18n'

// utils.ts
export const t = (text: keyof GeneratedI18nStructure) => $t(text)
export { objectDeepEqual } from '@commons/utils/object'
export { getUUID } from '@commons/utils/random'
export { copyText } from '@commons/utils/string'
