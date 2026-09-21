// powersync 时间无时区，按 UTC 解析
export function toUtcDate(s: string | null | undefined): Date {
  if (!s) return new Date(NaN)
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s)
  return new Date(s.replace(' ', 'T') + 'Z')
}
