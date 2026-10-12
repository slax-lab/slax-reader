/** Resolve operator-owned queue names without coupling business handlers to an account. */
export function queueChannel(name: string, encoded?: string): string {
  if (!encoded) return name // Compatibility for existing deployments without a mapping.
  const channels: unknown = JSON.parse(encoded)
  if (!channels || typeof channels !== 'object' || Array.isArray(channels)) throw new Error('Invalid queue channel configuration')
  if (!Object.prototype.hasOwnProperty.call(channels, name)) throw new Error(`Unconfigured queue: ${name}`)
  const channel = (channels as Record<string, unknown>)[name]
  if (typeof channel !== 'string' || !channel) throw new Error('Invalid queue channel configuration')
  return channel
}
