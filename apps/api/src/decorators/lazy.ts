export type LazyInstance<T> = () => T

export function lazy<T>(factory: () => T): LazyInstance<T> {
  let instance: T | undefined

  return () => {
    if (!instance) instance = factory()
    return instance
  }
}
