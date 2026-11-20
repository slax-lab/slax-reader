import { isValid, parseISO } from 'date-fns'

// Article publish times arrive as ISO 8601 strings or as free-form dates (RFC 2822, "March 5, 2024").
// ISO 8601 is parsed first, including compact forms such as 20240305, then the platform parser.
export function parsePublishedTime(value: string): Date | undefined {
  const text = value.trim()
  const iso = parseISO(text)
  if (isValid(iso)) return iso
  const native = new Date(text)
  return isValid(native) ? native : undefined
}
