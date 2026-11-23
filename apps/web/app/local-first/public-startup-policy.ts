import { EMAIL_LOGIN_PATH, EMAIL_LOGIN_WEB_PATH } from '@slax-reader/contracts/email-auth'

export type PublicTokenState = 'absent' | 'present' | 'error'

export function isFastPublicPath(pathname: string): boolean {
  return pathname === EMAIL_LOGIN_PATH || pathname === EMAIL_LOGIN_WEB_PATH || pathname === '/login' || pathname === '/login/' || pathname === '/guide' || pathname === '/guide/'
}

export function isPublicStartupEntryPath(pathname: string): boolean {
  return pathname === '/' || isFastPublicPath(pathname)
}

export function shouldBypassPublicDatabase(input: { enabled: boolean; pathname: string; topLevel: boolean; tokenState: PublicTokenState }): boolean {
  return input.enabled && input.topLevel && isPublicStartupEntryPath(input.pathname) && input.tokenState === 'absent'
}

export function needsPublicDocumentExit(bypassed: boolean, destinationPath: string): boolean {
  return bypassed && !isFastPublicPath(destinationPath)
}
