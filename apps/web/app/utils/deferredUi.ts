declare const __SLAX_DEFERRED_INDEX__: string

const resources = new Map<string, Promise<void>>()
let index: Promise<Record<string, string[]>> | undefined

export async function loadDeferredUi<T>(name: string, load: () => Promise<T>): Promise<T> {
  if (typeof __SLAX_DEFERRED_INDEX__ === 'undefined') return load()

  const config = useRuntimeConfig().app
  const base = String(config.cdnURL || config.baseURL).replace(/[/]$/, '')
  const directory = config.buildAssetsDir.replace(/^[/]|[/]$/g, '')
  const assetUrl = (file: string) => new URL(`${base}/${directory}/${file}`, window.location.href).href

  if (!index) {
    index = fetch(assetUrl(__SLAX_DEFERRED_INDEX__)).then(async response => {
      if (!response.ok) throw new Error('Optional interface index unavailable')
      return response.json() as Promise<Record<string, string[]>>
    }).catch(error => {
      index = undefined
      throw error
    })
  }

  const files = (await index)[name]
  if (!files?.length) throw new Error(`Optional interface is missing: ${name}`)
  await Promise.all(files.map(file => {
    const url = assetUrl(file)
    const existing = resources.get(url)
    if (existing) return existing
    const task = fetch(url, { cache: 'force-cache', credentials: 'same-origin' }).then(async response => {
      const type = response.headers.get('content-type') || ''
      if (!response.ok || (file.endsWith('.js') ? !/(?:javascript|ecmascript)/i.test(type) : !type.includes('text/css'))) {
        throw new Error('Optional interface resource unavailable')
      }
      await response.arrayBuffer()
    }).catch(error => {
      resources.delete(url)
      throw error
    })
    resources.set(url, task)
    return task
  }))
  return load()
}
