import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const sourceRoot = resolve(import.meta.dirname, '../..')
const tsx = resolve(sourceRoot, 'node_modules/.bin/tsx')
let workdir: string
let script: string
let input: string
let output: string

const command = (args: string[]) => spawnSync(tsx, [script, ...args], { cwd: workdir, encoding: 'utf8' })

const generate = (args: string[]) => {
  const result = command(args)
  if (result.status !== 0) throw new Error(`generator failed: ${result.stderr || result.stdout}`)
  return result
}

const readGenerated = () => {
  const contents = readFileSync(output, 'utf8')
  const version = /version: "([0-9a-f]{12})"/.exec(contents)?.[1]
  const values = /values: (\[[\s\S]*?\]),\n\} as const/.exec(contents)?.[1]
  if (!version || !values) throw new Error('generated output missing fields')
  return { contents, version, values: JSON.parse(values.replace(/,\s*\]$/, ']')) as number[] }
}

const loadGenerated = () => {
  const loader = join(workdir, 'check.ts')
  writeFileSync(
    loader,
    `import { EMBEDDING_MEAN } from './src/utils/embeddingMean'
import { VECTOR_DIMENSIONS, VECTOR_MODEL } from './src/utils/vectorEmbedding'
if (EMBEDDING_MEAN.model !== VECTOR_MODEL || EMBEDDING_MEAN.dimensions !== VECTOR_DIMENSIONS || EMBEDDING_MEAN.values.length !== VECTOR_DIMENSIONS) throw new Error('invalid_embedding_mean')
console.log(JSON.stringify({ version: EMBEDDING_MEAN.version, model: EMBEDDING_MEAN.model, dimensions: EMBEDDING_MEAN.dimensions, sampleSize: EMBEDDING_MEAN.sampleSize, values: EMBEDDING_MEAN.values }))
`
  )
  const result = spawnSync(tsx, [loader], { cwd: workdir, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`loading generated output failed: ${result.stderr || result.stdout}`)
  return JSON.parse(result.stdout) as { version: string; model: string; dimensions: number; sampleSize: number; values: number[] }
}

beforeAll(() => {
  workdir = realpathSync(mkdtempSync(join(tmpdir(), 'vector-embedding-mean-')))
  symlinkSync(resolve(sourceRoot, 'node_modules'), join(workdir, 'node_modules'))
  writeFileSync(join(workdir, 'package.json'), '{"type":"module"}\n')
  script = join(workdir, 'script/vector-embedding-mean.ts')
  input = join(workdir, 'vectors.json')
  output = join(workdir, 'src/utils/embeddingMean.ts')
  spawnSync('mkdir', ['-p', join(workdir, 'script'), join(workdir, 'src/utils')])
  copyFileSync(resolve(sourceRoot, 'script/vector-embedding-mean.ts'), script)
  copyFileSync(resolve(sourceRoot, 'src/utils/vectorEmbedding.ts'), join(workdir, 'src/utils/vectorEmbedding.ts'))
  copyFileSync(resolve(sourceRoot, 'src/utils/embeddingMean.ts'), output)
})

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true })
})

describe('vector embedding mean generator', () => {
  const axis = (index: number) => Array.from({ length: 1024 }, (_, position) => (position === index ? 1 : 0))

  test('is deterministic for the same input and writes the arithmetic mean of unit vectors', () => {
    writeFileSync(input, JSON.stringify([axis(0).map(value => value * 3), axis(1)]))
    generate(['--input', input, '--source', 'test sample'])
    const first = readGenerated()
    const firstLoad = loadGenerated()
    generate(['--input', input, '--source', 'test sample'])
    const second = readGenerated()
    expect(second.version).toBe(first.version)
    expect(second.values).toEqual(first.values)
    expect(first.version).toMatch(/^[0-9a-f]{12}$/)
    const expected = axis(0).map((_, position) => (position === 0 || position === 1 ? 0.5 : 0))
    first.values.forEach((value, position) => expect(value).toBeCloseTo(expected[position], 12))
    expect(firstLoad.version).toBe(first.version)
    expect(firstLoad.model).toBe('jina-embeddings-v5-omni-small')
    expect(firstLoad.dimensions).toBe(1024)
    expect(firstLoad.sampleSize).toBe(2)
    expect(firstLoad.values).toEqual(first.values)
    expect(first.contents).toContain('model: "jina-embeddings-v5-omni-small"')
    expect(first.contents).not.toContain('VECTOR_MODEL')
    generate(['--input', input, '--source', 'another sample label'])
    const relabelled = readGenerated()
    expect(relabelled.version).toBe(first.version)
    expect(relabelled.values).toEqual(first.values)
  })

  test('the loader rejects a generated asset whose literal model differs from the runtime model', () => {
    writeFileSync(input, JSON.stringify([axis(0), axis(1)]))
    generate(['--input', input, '--source', 'test sample'])
    expect(loadGenerated().model).toBe('jina-embeddings-v5-omni-small')
    const runtime = join(workdir, 'src/utils/vectorEmbedding.ts')
    const original = readFileSync(runtime, 'utf8')
    try {
      writeFileSync(runtime, original.replace("export const VECTOR_MODEL = 'jina-embeddings-v5-omni-small'", "export const VECTOR_MODEL = 'different-runtime-model'"))
      const loader = join(workdir, 'check.ts')
      const result = spawnSync(tsx, [loader], { cwd: workdir, encoding: 'utf8' })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('invalid_embedding_mean')
    } finally {
      writeFileSync(runtime, original)
    }
  })

  test.each([
    ['wrong dimension', '[[' + Array(1023).fill('0').join(',') + ']]', 'invalid_vector_input'],
    ['non-finite value', '[[' + ['1e400', ...Array(1023).fill('0')].join(',') + ']]', 'invalid_vector_input'],
    ['empty input', '[]', 'empty_vector_input'],
    ['non-array members', '[[1,2,3]]', 'invalid_vector_input']
  ])('rejects %s without writing output', (_name, payload, error) => {
    const before = readFileSync(output, 'utf8')
    writeFileSync(input, payload)
    const result = command(['--input', input, '--source', 'test sample'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`"error":"${error}"`)
    expect(readFileSync(output, 'utf8')).toBe(before)
  })

  test('rejects missing, unknown and duplicate options', () => {
    const missing = command([])
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('missing_required_option')
    const unknown = command(['--input', input, '--source', 'x', '--output', 'y'])
    expect(unknown.status).toBe(1)
    expect(unknown.stderr).toContain('unknown_option')
    const duplicate = command(['--input', input, '--input', input, '--source', 'x'])
    expect(duplicate.status).toBe(1)
    expect(duplicate.stderr).toContain('duplicate_option')
    const absent = command(['--input', join(workdir, 'missing.json'), '--source', 'x'])
    expect(absent.status).toBe(1)
  })
})
