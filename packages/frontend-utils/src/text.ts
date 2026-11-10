export const extractMarkdownFromText = (text: string) => {
  if (!text) {
    return text
  }

  const markdownRegex = /^(#[#]?[ \t]+.*|[ \t]*-[ \t]+.+)$/gm
  const matches = text.match(markdownRegex)

  if (!matches) {
    return ''
  }

  return matches.join(String.fromCharCode(10))
}

export const extractHTMLTextContent = (htmlString: string) => {
  return htmlString
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
