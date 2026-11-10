import { randomUUID } from 'node:crypto'
import type { Plugin } from 'vite'

interface Resource {
  file?: string
  imports?: string[]
  css?: string[]
  isEntry?: boolean
  prefetch?: boolean
}

const optionalModules = [
  'components/Snapshot/SnapshotAIPanel.vue',
  'components/Snapshot/SnapshotChatPanel.vue',
  'components/Modal/EditName.vue',
  'components/Modal/EditTag.vue',
  'components/Modal/Feedback.vue',
  'components/Modal/LoginModal.vue',
  'components/Modal/ShareModal.vue',
  'components/Modal/SnapshotStatusModal.vue'
]

export function createDeferredResourceHints() {
  const files = new Set<string>()
  const indexName = `deferred-ui-${randomUUID()}.json`
  const normalize = (path: string) => path.replaceAll('\\', '/').split('?')[0] ?? ''
  const fileName = (path: string) => path.startsWith('_nuxt/') ? path.slice(6) : path

  const plugin = (): Plugin => ({
    name: 'slax-deferred-resource-hints',
    apply: 'build',
    config: () => ({ define: { __SLAX_DEFERRED_INDEX__: JSON.stringify(indexName) } }),
    generateBundle(_options, bundle) {
      files.clear()
      const resources: Record<string, string[]> = {}
      const dependencies = (root: string) => {
        const seen = new Set<string>()
        const visit = (file: string) => {
          if (seen.has(file)) return
          seen.add(file)
          const chunk = bundle[file]
          if (chunk?.type !== 'chunk') return
          for (const imported of chunk.imports) visit(imported)
          for (const css of chunk.viteMetadata?.importedCss ?? []) seen.add(css)
        }
        visit(root)
        return [...seen].map(fileName)
      }
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        for (const source of optionalModules) {
          if (!Object.keys(chunk.modules).some(id => normalize(id).endsWith(`/app/${source}`))) continue
          files.add(fileName(chunk.fileName))
          resources[source.split('/').at(-1)!.replace('.vue', '')] = dependencies(chunk.fileName)
        }
      }
      this.emitFile({ type: 'asset', fileName: `_nuxt/${indexName}`, source: JSON.stringify(resources) })
    }
  })

  function apply(manifest: Record<string, Resource>) {
    const closure = (roots: string[]) => {
      const seen = new Set<string>()
      const visit = (key: string) => {
        if (seen.has(key)) return
        seen.add(key)
        const resource = manifest[key]
        for (const dependency of resource?.imports ?? []) visit(dependency)
        for (const css of resource?.css ?? []) visit(css)
      }
      roots.forEach(visit)
      return seen
    }
    const entries = Object.entries(manifest)
    const required = closure(entries.filter(([, entry]) => entry.isEntry).map(([key]) => key))
    const optional = closure(entries.filter(([, entry]) => entry.file && files.has(fileName(entry.file))).map(([key]) => key))
    for (const key of optional) {
      const entry = manifest[key]
      if (entry && !required.has(key)) entry.prefetch = false
    }
  }

  return { plugin, apply }
}
