export const isSlaxWebsite = (url: string) => {
  try {
    return url.startsWith(process.env.SHARE_BASE_URL || '')
  } catch (error) {
    console.error(error)
    return false
  }
}
