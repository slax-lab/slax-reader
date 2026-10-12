import { type GeneratedI18nStructure, i18n } from '#i18n'

export const $t = (name: keyof GeneratedI18nStructure, params?: string[]) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return i18n.t(name as any, params as any)
}
