import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const testsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const extensionDir = path.resolve(testsDir, '..')
const buildDir = path.join(extensionDir, 'build', 'chrome-mv3')
const wxt = path.join(extensionDir, 'node_modules', '.bin', 'wxt')
const config = path.join(testsDir, 'wxt.offscreen-test.config.mjs')

export const buildTestExtension = async ({ env = {}, fastTimings = false } = {}) => {
  execFileSync(wxt, ['build', '-c', config], {
    cwd: extensionDir,
    env: {
      ...process.env,
      ...env,
      OFFSCREEN_TEST_FAST: fastTimings ? '1' : ''
    },
    stdio: 'inherit'
  })

  await mkdir(buildDir, { recursive: true })
  await writeFile(
    path.join(buildDir, 'bridge-test.html'),
    '<!doctype html><meta charset="utf-8"><title>Extension test page</title>'
  )
  return buildDir
}

export { buildDir }
