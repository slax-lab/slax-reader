import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const embedded = new URL('../../../../packages/reader-embed/assets/', import.meta.url)
test('imported reader assets match their pinned current-source hashes and generated embedding', async () => {
  const manifest = JSON.parse(await readFile(new URL('source-manifest.json', embedded), 'utf8'))
  assert.equal(manifest.sourceCommit, '9951904405159f49f24effd4d42815f77ff33442')
  for (const file of manifest.files) {
    const content = await readFile(file.path === 'js/react-native-host.js' ? new URL('../../assets/embedded/js/react-native-host.js', import.meta.url) : new URL(file.path, embedded))
    assert.equal(createHash('sha256').update(content).digest('hex'), file.sha256, file.path)
    assert.equal(content.length, file.bytes, file.path)
  }
  const result = spawnSync(process.execPath, [new URL('../../src/reader/generate-assets.mjs', import.meta.url).pathname, '--check'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})
