export const formatDate = (date: Date, format: string) => {
  const pad = (num: number) => (num < 10 ? `0${num}` : `${num}`)

  const replacements: { [key: string]: string } = {
    YYYY: date.getFullYear().toString(),
    YY: date.getFullYear().toString().slice(-2),
    MM: pad(date.getMonth() + 1), // 月份从 0 开始，所以需要加 1
    DD: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds())
  }

  return format.replace(/YYYY|YY|MM|DD|HH|mm|ss/g, matched => replacements[matched] ?? matched)
}
