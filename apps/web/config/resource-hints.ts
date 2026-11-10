interface ResourceHintEntry {
  src?: string
  prefetch?: boolean
}

const databaseModules = [
  '@journeyapps/wa-sqlite/dist/wa-sqlite.mjs',
  '@journeyapps/wa-sqlite/dist/wa-sqlite-async.mjs',
  '@journeyapps/wa-sqlite/dist/mc-wa-sqlite.mjs',
  '@journeyapps/wa-sqlite/dist/mc-wa-sqlite-async.mjs',
  '@powersync/shared-internals/dist/websockets.mjs'
]

export function removeDatabasePrefetch(manifest: Record<string, ResourceHintEntry>): void {
  for (const [key, entry] of Object.entries(manifest)) {
    const source = (entry.src ?? key).replaceAll('\\', '/').split('?')[0]
    if (databaseModules.some(module => source === module || source?.endsWith(`/node_modules/${module}`))) {
      entry.prefetch = false
    }
  }
}
