let current: string | undefined

/** Updated by the navigator state listener; route names only, never parameters. */
export function setCurrentScreen(name: string | undefined) {
  current = name
}

export function currentScreen(): string | undefined {
  return current
}
