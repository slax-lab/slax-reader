import baseConfig from '../wxt.config.ts'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'wxt'

const testsDir = path.dirname(fileURLToPath(import.meta.url))
const offscreenSource = path.resolve(testsDir, '../src/entrypoints/offscreen/main.ts')
const fastTimings = process.env.OFFSCREEN_TEST_FAST === '1'

const replaceRequired = (code, pattern, replacement) => {
  const transformed = code.replace(pattern, replacement)
  if (transformed === code) throw new Error(`offscreen test instrumentation did not match ${String(pattern)}`)
  return transformed
}

const instrumentOffscreen = (code, id) => {
  if (id !== offscreenSource) return code

  let transformed = replaceRequired(
    code,
    'const runtimeBrowser =',
    `let testMountCount = 0
let testIframeGeneration = 0
let testCallCount = 0

const runtimeBrowser =`
  )
  transformed = replaceRequired(transformed, 'const mountBridge = () => {', 'const mountBridge = () => {\n  testMountCount += 1')
  transformed = replaceRequired(
    transformed,
    /([ \t]*)const el = document\.createElement\((['"])iframe\2\)/,
    '$1testIframeGeneration += 1\n$1const el = document.createElement($2iframe$2)'
  )
  transformed = replaceRequired(
    transformed,
    /const call = async \(method(?:: string)?, params(?:\?: Record<string, unknown>)?\) => \{/, '$&\n  testCallCount += 1'
  )

  if (fastTimings) {
    transformed = replaceRequired(transformed, /const REQUEST_TIMEOUT_MS = (?:15_000|15000|15e3)/, 'const REQUEST_TIMEOUT_MS = 2_000')
    transformed = replaceRequired(transformed, /const LOAD_TIMEOUT_MS = (?:60_000|60000|6e4)/, 'const LOAD_TIMEOUT_MS = 800')
    transformed = replaceRequired(transformed, /const RETRY_COOLDOWN_MS = (?:60_000|60000|6e4)/, 'const RETRY_COOLDOWN_MS = 800')
  }

  transformed += `

runtimeBrowser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const msg = message
  if (msg?.target !== 'slax-offscreen' || msg.method !== 'debug-state') return false
  sendResponse({
    success: true,
    data: {
      state: mountState,
      iframeExists: Boolean(iframe),
      iframeSrc: iframe?.src ?? null,
      retryAfter,
      transportFailures,
      mountCount: testMountCount,
      iframeGeneration: testIframeGeneration,
      callCount: testCallCount
    }
  })
  return false
})
`
  return { code: transformed, map: null }
}

export default defineConfig({
  ...baseConfig,
  vite: async config => {
    const baseVite = await (typeof baseConfig.vite === 'function' ? baseConfig.vite(config) : baseConfig.vite)
    return {
      ...baseVite,
      plugins: [...(baseVite?.plugins || []), { name: 'offscreen-test-instrumentation', enforce: 'post', transform: instrumentOffscreen }]
    }
  }
})
