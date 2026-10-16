export function parseSourceTimestamp(value: string): number {
  const match = /^(\+\d{5,9}|-\d{4,9}|\d{4})-(\d{2})-(\d{2})([Tt ])(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,9}))?(?:[Zz]|([+-])(\d{2})(?::(\d{2})(?::(\d{2}))?)?)?$/.exec(value);
  if (!match || match[0].length !== value.length) return NaN;
  const [, yearText, monthText, dayText, separator, hourText, minuteText, secondText, fraction, sign, offsetHourText, offsetMinuteText, offsetSecondText] = match;
  if (sign && !offsetMinuteText && (separator === ' ' || !secondText)) return NaN;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText), hour = Number(hourText), minute = Number(minuteText), second = Number(secondText ?? 0);
  const offsetHour = Number(offsetHourText ?? 0), offsetMinute = Number(offsetMinuteText ?? 0), offsetSecond = Number(offsetSecondText ?? 0);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59 || offsetHour > 18 || offsetMinute > 59 || offsetSecond > 59 || (offsetHour === 18 && (offsetMinute || offsetSecond))) return NaN;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, Number((fraction ?? '').padEnd(3, '0').slice(0, 3)));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return NaN;
  const offset = (offsetHour * 3600 + offsetMinute * 60 + offsetSecond) * 1000;
  return date.getTime() - (sign === '-' ? -offset : offset);
}
