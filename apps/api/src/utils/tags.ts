/**
 * Tag name normalization and AI tag picking. Pure functions, shared by the
 * public and private backends.
 */

export interface VocabularyTag {
  id?: number
  name: string
  source?: 'auto' | 'mine'
}

/** trim, collapse inner whitespace, fold full-width ASCII to half-width */
export function normalizeTagName(name: string): string {
  if (!name) return ''
  let out = ''
  for (const ch of name) {
    const code = ch.charCodeAt(0)
    if (code === 0x3000) out += ' '
    else if (code >= 0xff01 && code <= 0xff5e) out += String.fromCharCode(code - 0xfee0)
    else out += ch
  }
  return out.replace(/\s+/g, ' ').trim()
}

/** names the AI may choose from, split the way the prompt wants them */
export function groupVocabulary(vocabulary: VocabularyTag[]): { mine: string[]; auto: string[] } {
  const mine: string[] = []
  const auto: string[] = []
  for (const tag of vocabulary) (tag.source === 'mine' ? mine : auto).push(tag.name)
  return { mine, auto }
}

/**
 * Keep only candidates that exist in the vocabulary, dedupe, put "mine" first
 * (stable within each group), cap at `limit`.
 */
export function pickTagsForBookmark<T extends VocabularyTag>(candidates: string[], vocabulary: T[], limit = 3): T[] {
  const byName = new Map<string, T>()
  for (const tag of vocabulary) if (!byName.has(tag.name)) byName.set(tag.name, tag)

  const seen = new Set<string>()
  const picked: T[] = []
  for (const name of candidates) {
    const tag = byName.get(name)
    if (!tag || seen.has(name)) continue
    seen.add(name)
    picked.push(tag)
  }

  const mine = picked.filter(t => t.source === 'mine')
  const auto = picked.filter(t => t.source !== 'mine')
  return [...mine, ...auto].slice(0, limit)
}
