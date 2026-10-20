import { DesktopAuthError } from './desktopAuthPolicy'

export function isLocalDesktopDeployment(env: Env): boolean {
  try {
    const web = new URL(env.FRONT_END_URL)
    return env.RUN_ENV === 'development' && ['localhost', '127.0.0.1', '[::1]'].includes(web.hostname)
  } catch {
    return false
  }
}

export function desktopDeployment(env: Env): string {
  if (isLocalDesktopDeployment(env)) return `local:${new URL(env.FRONT_END_URL).origin}`
  if (env.DESKTOP_AUTH_ENABLED !== 'true' || !env.DESKTOP_AUTH_DEPLOYMENT_ID || env.DESKTOP_AUTH_DEPLOYMENT_ID.length > 128)
    throw new DesktopAuthError(503, 'DESKTOP_AUTH_UNAVAILABLE')
  const web = new URL(env.FRONT_END_URL)
  if (!['http:', 'https:'].includes(web.protocol) || web.username || web.password) throw new DesktopAuthError(503, 'DESKTOP_AUTH_UNAVAILABLE')
  return `${env.DESKTOP_AUTH_DEPLOYMENT_ID}:${web.origin}`
}
