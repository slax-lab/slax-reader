import { createDeferredResourceHints } from '../../../config/deferred-resource-hints'

import { describe, expect, it, vi } from 'vitest'

describe('deferred resource hints', () => {
  function collect(source: string) {
    const hints = createDeferredResourceHints()
    const hook = hints.plugin().generateBundle as (options: object, bundle: object) => void
    hook.call({ emitFile: () => {} }, {}, { '_nuxt/optional.js': { type: 'chunk', fileName: '_nuxt/optional.js', imports: [], modules: { [source]: {} } } })
    return hints
  }

  it('uses exact module provenance and suppresses optional dependencies without changing preload', () => {
    const hints = collect('/repo/apps/web/app/components/Snapshot/SnapshotChatPanel.vue')
    const manifest = {
      entry: { file: 'entry.js', isEntry: true, imports: ['vue'], prefetch: true, preload: true },
      vue: { file: 'vue.js', prefetch: true, preload: true },
      optional: { file: 'optional.js', imports: ['renderer', 'vue'], css: ['style'], prefetch: true, preload: true },
      renderer: { file: 'renderer.js', prefetch: true, preload: true },
      style: { file: 'style.css', prefetch: true, preload: true },
      unrelated: { file: 'other.js', prefetch: true, preload: true }
    }
    const original = structuredClone(manifest)
    hints.apply(manifest)
    expect(manifest).toEqual({ ...original, optional: { ...original.optional, prefetch: false }, renderer: { ...original.renderer, prefetch: false }, style: { ...original.style, prefetch: false } })
  })

  it('keeps unknown or merely similarly named source modules untouched', () => {
    const hints = collect('/repo/other/SnapshotChatPanel.vue')
    const manifest = { optional: { file: 'optional.js', prefetch: true } }
    hints.apply(manifest)
    expect(manifest.optional.prefetch).toBe(true)
  })

  it('supports Windows paths and Vue query suffixes', () => {
    const path = 'C:/repo/apps/web/app/components/Modal/LoginModal.vue?vue&type=script'.replaceAll('/', String.fromCharCode(92))
    const hints = collect(path)
    const manifest = { modal: { file: 'optional.js', prefetch: true } }
    hints.apply(manifest)
    expect(manifest.modal.prefetch).toBe(false)
  })

  it('emits optional JS and CSS dependencies without unrelated chunks', () => {
    const hints = createDeferredResourceHints()
    const emitFile = vi.fn()
    const hook = hints.plugin().generateBundle as (options: object, bundle: object) => void
    const source = '/repo/apps/web/app/components/Snapshot/SnapshotChatPanel.vue'
    hook.call({ emitFile }, {}, {
      '_nuxt/panel.js': { type: 'chunk', fileName: '_nuxt/panel.js', modules: { [source]: {} }, imports: ['_nuxt/renderer.js'], viteMetadata: { importedCss: new Set(['_nuxt/panel.css']) } },
      '_nuxt/renderer.js': { type: 'chunk', fileName: '_nuxt/renderer.js', modules: {}, imports: [] },
      '_nuxt/unused.js': { type: 'chunk', fileName: '_nuxt/unused.js', modules: {}, imports: [] }
    })
    expect(emitFile).toHaveBeenCalledOnce()
    const asset = emitFile.mock.calls[0]![0]
    expect(asset.fileName).toMatch(/^_nuxt[/]deferred-ui-.+[.]json$/)
    expect(JSON.parse(asset.source)).toEqual({ SnapshotChatPanel: ['panel.js', 'renderer.js', 'panel.css'] })
  })

  it('preserves chunks that contain optional code but are required by the entrypoint', () => {
    const hints = collect('/repo/apps/web/app/components/Modal/EditTag.vue')
    const manifest = { root: { file: 'entry.js', isEntry: true, imports: ['shared'] }, shared: { file: 'optional.js', prefetch: true, preload: true } }
    hints.apply(manifest)
    expect(manifest.shared).toEqual({ file: 'optional.js', prefetch: true, preload: true })
  })
})
