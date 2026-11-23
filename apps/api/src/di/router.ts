import type { Container } from '../decorators/di'

type TierRouter<R> = (container: Container) => R

// Each Worker passes its own generated router; this module only decides whether the host is served.
export function getRouter<R>(host: string, container: Container, apiOrigin: string | undefined, router: TierRouter<R>): R | null {
  if (apiOrigin) {
    try {
      const configured = new URL(apiOrigin)
      if (['http:', 'https:'].includes(configured.protocol) && !configured.username && !configured.password && configured.host === host) return router(container)
    } catch {
      /* Invalid operator config must not allow arbitrary hosts. */
    }
  }
  switch (host) {
    case 'reader.local:8787':
    case 'localhost:8686':
    case 'reader-api.slax.dev':
    case 'reader-api.slax.com':
    case 'apix.reader.slax.app':
    case 'api-reader.slax.com':
    case 'api-reader-beta.slax.com':
    case 'localhost:8787':
      return router(container)
    default:
      return null
  }
}
