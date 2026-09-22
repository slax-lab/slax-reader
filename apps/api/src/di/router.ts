import { Container } from '../decorators/di'
import { getRouter as readerRouter } from '../di/generated/readerRouter'

export function getRouter(host: string, container: Container, apiOrigin?: string) {
  if (apiOrigin) {
    try {
      const configured = new URL(apiOrigin)
      if (['http:', 'https:'].includes(configured.protocol) && !configured.username && !configured.password && configured.host === host) return readerRouter(container)
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
      return readerRouter(container)
    default:
      return null
  }
}
