const CACHE_DURATION_SECONDS = 1 * 24 * 60 * 60

export default {
  async fetch(request, env, ctx) {
    const cacheKey = new Request(request.url, {
      method: 'GET'
    })
    console.log(`Retrieving cache for: ${cacheKey.url}.`)

    const cache = caches.default

    let response = await cache.match(cacheKey)

    if (!response) {
      console.log(`Cache miss for: ${cacheKey.url}. Fetching from origin...`)
      const url = new URL(request.url)
      url.pathname = '/static/image/snippets'

      response = await fetch(new Request(url.toString(), request))

      response = new Response(response.body, response)

      response.headers.set('Cache-Control', `s-maxage=${CACHE_DURATION_SECONDS}`)
      response.headers.set('x-snippets-cache', 'stored')

      await cache.put(cacheKey, response.clone())
    } else {
      console.log(`Cache hit for: ${cacheKey.url}.`)
      response = new Response(response.body, response)
      response.headers.set('x-snippets-cache', 'hit')

      const ageHeader = response.headers.get('Age')
      if (ageHeader && parseInt(ageHeader, 10) > CACHE_DURATION_SECONDS) {
        console.log(`Cache expired for: ${cacheKey.url}. Deleting cached response...`)
        await cache.delete(cacheKey)
        response.headers.set('x-snippets-cache', 'deleted')
      }
    }

    return response
  }
}
