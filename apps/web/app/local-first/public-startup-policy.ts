export type PublicTokenState = 'absent' | 'present' | 'error'

export function isFastPublicPath(pathname: string): boolean {
  return pathname === '/login' || pathname === '/login/' || pathname === '/guide' || pathname === '/guide/'
}

export function shouldBypassPublicDatabase(input: { enabled: boolean; pathname: string; topLevel: boolean; tokenState: PublicTokenState }): boolean {
  return input.enabled && input.topLevel && isFastPublicPath(input.pathname) && input.tokenState === 'absent'
}

export function needsPublicDocumentExit(bypassed: boolean, destinationPath: string): boolean {
  return bypassed && !isFastPublicPath(destinationPath)
}
