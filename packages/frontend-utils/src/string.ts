/**
 * 复制文本
 * @param text 文本
 */
export const copyText = async (text: string) => {
  const copyTextToClipboard = async (text: string) => {
    if (!navigator.clipboard) {
      // Clipboard API 不可用，使用 `document.execCommand` 作为后备方案
      fallbackCopyTextToClipboard(text)
      return
    }

    await navigator.clipboard.writeText(text)
  }

  // 后备方案，使用 `document.execCommand`
  const fallbackCopyTextToClipboard = async (text: string) => {
    const textArea = document.createElement('textarea')
    textArea.value = text
    document.body.appendChild(textArea)
    textArea.select()

    try {
      const successful = document.execCommand('copy')
      const msg = successful ? 'successful' : 'unsuccessful'
      console.log('Fallback: Copying text command was ' + msg)
    } catch (err) {
      console.error('Fallback: Oops, unable to copy', err)
    }

    document.body.removeChild(textArea)
  }

  await copyTextToClipboard(text)
}

/**
 * 返回附带https的字符串
 *  @param url 路径字符串
 */
export const urlHttpString = (url: string) => {
  if (url.startsWith('https://') || url.startsWith('http://')) {
    return url
  }

  return 'https://' + url
}

/**
 * 根据range返回对应文本
 */
export const getRangeTextWithNewlines = (range: Range): string => {
  const selection = window.getSelection()
  if (!selection) {
    console.warn('无法获取 window.getSelection()')

    const temp = document.createElement('div')
    temp.appendChild(range.cloneContents())
    return temp.innerText
  }

  const originalRanges: Range[] = []
  for (let i = 0; i < selection.rangeCount; i++) {
    originalRanges.push(selection.getRangeAt(i))
  }

  try {
    selection.removeAllRanges()
    selection.addRange(range)

    const text = selection.toString()

    return text
  } finally {
    selection.removeAllRanges()
    for (const originalRange of originalRanges) {
      selection.addRange(originalRange)
    }
  }
}
