const originalFetch = globalThis.fetch

globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.hostname === 'registry.npmjs.org') {
    if (process.env.CLI_REGISTRY_FAIL) throw new Error('Registry offline')
    return new Response(JSON.stringify({ version: process.env.CLI_REGISTRY_VERSION }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error(`External network prohibited in CLI test: ${url.hostname}`)
  return originalFetch(input, options)
}
