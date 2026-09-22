import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'smol-toml'
import { projectWebWranglerConfig, readWebBindingSelection, WEB_STATE_DIR, WEB_STATE_V3 } from '../../../config/backend-binding'

function withConfig(contents: string, env: NodeJS.ProcessEnv, local = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slax-web-binding-'))
  const filename = path.join(dir, 'api.toml')
  fs.writeFileSync(filename, contents)
  return readWebBindingSelection({ env: { ...env, SLAX_API_CONFIG: filename }, local })
}

describe('Web API binding projection', () => {
  it('uses the shared API Wrangler state with Nuxt v3 and CLI base paths', () => {
    expect(WEB_STATE_DIR).toMatch(/deploy[\\/]local[\\/].wrangler[\\/]state$/)
    expect(WEB_STATE_V3).toMatch(/deploy[\\/]local[\\/].wrangler[\\/]state[\\/]v3$/)
  })

  it('projects EDGE and OSS from the top-level native API config', () => {
    const selection = withConfig(`
name = "reader-core"
compatibility_date = "2026-01-01"
compatibility_flags = ["nodejs_compat_v2", "global_fetch_strictly_public"]
[[services]]
binding = "EDGE"
service = "reader-edge-custom"
[[r2_buckets]]
binding = "OSS"
bucket_name = "reader-prod"
preview_bucket_name = "reader-preview"
`, { SLAX_ENV: 'production' })
    const config = parse(projectWebWranglerConfig(selection)) as any
    expect(config.services).toEqual([{ binding: 'BACKEND', service: 'reader-edge-custom', entrypoint: 'ContentEntry' }])
    expect(config.r2_buckets[0]).toMatchObject({ binding: 'OSS', bucket_name: 'reader-prod', preview_bucket_name: 'reader-preview' })
    expect(config.env).toBeUndefined()
    expect(config.vars).toBeUndefined()
  })

  it('selects env.dev only for local development', () => {
    const source = `
name = "reader-core"
compatibility_date = "2026-01-01"
[[services]]
binding = "EDGE"
service = "reader-edge-top"
[[r2_buckets]]
binding = "OSS"
bucket_name = "reader-top"
[env.dev]
name = "reader-core-dev"
[[env.dev.services]]
binding = "EDGE"
service = "reader-edge-dev"
[[env.dev.r2_buckets]]
binding = "OSS"
bucket_name = "reader-dev"
`
    expect(withConfig(source, {}, true)).toMatchObject({ apiEnvironment: 'dev', apiWorkerName: 'reader-edge-dev', bucketName: 'reader-dev' })
    expect(withConfig(source, {}, false)).toMatchObject({ apiEnvironment: undefined, apiWorkerName: 'reader-edge-top', bucketName: 'reader-top' })
  })

  it('honours explicit SLAX_API_ENV independently of SLAX_ENV', () => {
    const source = `
name = "reader-core"
compatibility_date = "2026-01-01"
[[services]]
binding = "EDGE"
service = "reader-edge-top"
[[r2_buckets]]
binding = "OSS"
bucket_name = "reader-top"
[env.beta]
name = "reader-core-beta"
[[env.beta.services]]
binding = "EDGE"
service = "reader-edge-beta"
[[env.beta.r2_buckets]]
binding = "OSS"
bucket_name = "reader-beta"
`
    expect(withConfig(source, { SLAX_ENV: 'production', SLAX_API_ENV: 'beta' })).toMatchObject({ apiEnvironment: 'beta', apiWorkerName: 'reader-edge-beta' })
  })

  it('keeps offline builds usable when API config is absent', () => {
    const selection = readWebBindingSelection({ env: { SLAX_ENV: 'beta' }, local: false })
    expect(selection.configFound).toBe(false)
    expect(selection.apiWorkerName).toBe('reader-edge')
  })

  it('keeps local dev usable with a helpful warning when default API config is absent', () => {
    const selection = readWebBindingSelection({ env: {}, local: true })
    expect(selection.configFound).toBe(false)
    expect(selection.apiWorkerName).toBe('reader-edge')
  })

  it('requires an explicitly selected missing config', () => {
    expect(() => readWebBindingSelection({ env: { SLAX_API_CONFIG: '/tmp/slax-reader-v2-no-api.toml' } })).toThrow(/configuration is missing/i)
    expect(() => readWebBindingSelection({ env: { SLAX_API_ENV: 'dev' } })).toThrow(/configuration is missing/i)
  })

  it('requires OSS in a selected named environment because bindings are not inherited', () => {
    const source = `name = "reader-core"\n[[r2_buckets]]\nbinding = "OSS"\nbucket_name = "top"\n[env.dev]\nname = "reader-core-dev"\n[[env.dev.services]]\nbinding = "EDGE"\nservice = "edge-dev"\n`
    expect(() => withConfig(source, {}, true)).toThrow(/OSS/i)
  })

  it('allows an explicit service override and keeps Web-owned compatibility settings', () => {
    const source = `name = "reader-core"\ncompatibility_date = "1900-01-01"\ncompatibility_flags = ["unsafe"]\n[[services]]\nbinding = "EDGE"\nservice = "from-api"\n[[r2_buckets]]\nbinding = "OSS"\nbucket_name = "bucket"\n`
    const selection = withConfig(source, { BACKEND_SERVICE_NAME: 'override-service' })
    const config = parse(projectWebWranglerConfig(selection)) as any
    expect(config.services[0].service).toBe('override-service')
    expect(config.compatibility_date).toBe('2026-05-26')
    expect(config.compatibility_flags).toEqual(['nodejs_compat'])
  })
})
