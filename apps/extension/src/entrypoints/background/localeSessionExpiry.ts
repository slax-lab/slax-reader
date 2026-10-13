interface ExpiryDeps {
  session: { getToken(): Promise<string | null>; clearSession(expectedToken?: string): Promise<boolean | void> }
  invalidateLocale(): Promise<void>
  clearUserData(): Promise<void>
  teardown(): Promise<void>
  recalibrate(): void
}

export const expireLocaleSession = async (deps: ExpiryDeps, expectedToken?: string): Promise<void> => {
  if (expectedToken && (await deps.session.getToken()) !== expectedToken) return
  await deps.invalidateLocale()
  if (expectedToken && (await deps.session.getToken()) !== expectedToken) {
    deps.recalibrate()
    return
  }
  if ((await deps.session.clearSession(expectedToken)) === false) {
    deps.recalibrate()
    return
  }
  await Promise.allSettled([deps.clearUserData(), deps.teardown()])
}
