const youtubeHandler = (url: string, document: Document) => {
  const uUrl = new URL(url)
  const videoId = uUrl.searchParams.get('v')
  if (!videoId) return

  const psDom = document.querySelector('ps-dom-if')
  if (!psDom) return

  const iframe = document.createElement('iframe')
  iframe.setAttribute('id', 'player')
  iframe.setAttribute('width', '100%')
  iframe.setAttribute('height', '100%')
  iframe.setAttribute('src', `https://www.youtube.com/embed/${videoId}`)
  iframe.setAttribute('frameborder', '0')
  iframe.setAttribute('allowfullscreen', 'true')

  psDom?.replaceWith(iframe)
}

export { youtubeHandler }
