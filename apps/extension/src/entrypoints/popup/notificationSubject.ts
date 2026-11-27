const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function fitNotificationSubject(subject: string, fits: (candidate: string) => boolean): string {
  if (fits(subject)) return subject

  const characters = Array.from(graphemes.segment(subject), ({ segment }) => segment)
  let shortest = 1
  let longest = characters.length - 1
  let result = '…'
  while (shortest <= longest) {
    const kept = Math.floor((shortest + longest) / 2)
    const prefix = characters.slice(0, Math.ceil(kept / 2)).join('')
    const suffix = characters.slice(characters.length - Math.floor(kept / 2)).join('')
    const candidate = prefix + '…' + suffix
    if (fits(candidate)) {
      result = candidate
      shortest = kept + 1
    } else {
      longest = kept - 1
    }
  }
  return result
}
