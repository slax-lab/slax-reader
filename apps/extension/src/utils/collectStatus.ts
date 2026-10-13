import { $t } from './locale'
import type { GeneratedI18nStructure } from '#i18n'
export type CollectDisplay = { kind: 'message'; key: keyof GeneratedI18nStructure; params?: string[] } | { kind: 'raw'; text: string }
export const formatCollectDisplay = (display: CollectDisplay, frame = 0) => (display.kind === 'raw' ? display.text : $t(display.key, display.params)) + '.'.repeat(frame % 4)
